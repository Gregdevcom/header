import path from "path";
import express from "express";
import { fileURLToPath as fUTP } from "url";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import env from "dotenv";
import cookieParser from "cookie-parser";
import { OAuth2Client } from "google-auth-library";
import nodemailer from "nodemailer";
import helmet from "helmet";
import crypto from "crypto";
import mongoose from "mongoose";
import cron from "node-cron";
import fs from "fs";
import { User, Feedback } from "./mainSchemas.js";
import {
  validateSignUp,
  validatePass,
  validateName,
  validateEmail,
} from "./validators.js";
import { generalLimiter, authLimiter } from "./rateLimiters.js";
import NodeCache from "node-cache";

env.config();

const required = [
  "EMAIL_APP",
  "APP_URL",
  "MONGODB_URI",
  "ACCESS_TOKEN_SECRET",
  "REFRESH_TOKEN_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "EMAIL_USER",
  "EMAIL_PASS",
];

const privateKeyPem = fs.readFileSync("./jwt_es256_private.pem", "utf8");
const publicKeyPem = fs.readFileSync("./jwt_es256_public.pem", "utf8");

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

if (!privateKeyPem || !publicKeyPem) {
  console.error(`Missing required Pem keys.`);
  process.exit(1);
}

const URL = process.env.APP_URL;

const app = express();

app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

const __dirname = path.dirname(fUTP(import.meta.url));

const allowedOrigins = [URL];

const corsOptions = { origin: allowedOrigins, credentials: true };

app.use(cors(corsOptions));

app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                "https://maps.googleapis.com",
                "'unsafe-inline'",
                "https://unpkg.com",
                "https://cdn.jsdelivr.net",
              ],
              styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://unpkg.com",
                "https://fonts.googleapis.com",
                "https://cdn.jsdelivr.net",
              ],
              imgSrc: ["'self'", "data:", "https:", "https://cdn.jsdelivr.net"],
              fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",
                "https://fonts.googleapis.com",
                "https://cdn.jsdelivr.net",
                "https://unpkg.com",
                "data:",
              ],
              connectSrc: [
                "'self'",
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
              ],
              frameSrc: ["'self'"],
              objectSrc: ["'none'"],
              upgradeInsecureRequests: [],
            },
          }
        : false, // Disable CSP in development
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);

app.use(express.static(path.join(__dirname, "..", "public")));

app.use(express.urlencoded({ extended: true }));

app.use(express.json());

app.use(cookieParser());

app.use(generalLimiter);

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const transporter = nodemailer.createTransport({
  host: "smtp.zoho.eu",
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  requireTLS: true,
  connectionTimeout: 15000,
  socketTimeout: 15000,
});

const cacheKey = `news:today`;

const cacheEN = new NodeCache({
  stdTTL: 300,
  checkperiod: 280,
  useClones: false,
});

const cacheNL = new NodeCache({
  stdTTL: 300,
  checkperiod: 280,
  useClones: false,
});

// Routes:

app.get("/auth/google", (req, res) => {
  const authUrl = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["email", "profile"],
    prompt: "select_account",
  });
  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  // Google redirects here after login
  const { code, error } = req.query;

  if (error) {
    return res.redirect("/log-in?error=google_denied");
  }

  if (!code) {
    return res.redirect("/log-in?error=google_failed");
  }

  let session = null;

  try {
    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleEmail = payload.email;
    const googleName = payload.name;

    session = await mongoose.startSession();

    try {
      await session.startTransaction();
      const user = await User.findOne({ email: googleEmail }).session(session);
      if (!user) {
        await User.create(
          [
            {
              email: googleEmail,
              name: googleName,
              authProvider: "google",
              verified: true,
            },
          ],
          { session }
        );
      } else if (user.authProvider === "header") {
        await session.abortTransaction();
        return res.sendStatus(400);
      }

      const accessToken = jwt.sign(
        { email: googleEmail },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "10m" }
      );

      const refreshToken = jwt.sign(
        { email: googleEmail },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: "7d" }
      );

      await User.updateOne(
        { email: googleEmail },
        { $pull: { refreshTokens: { expiresAt: { $lte: new Date() } } } },
        { session }
      );

      await User.updateOne(
        { email: googleEmail },
        {
          $push: {
            refreshTokens: {
              token: hashToken(refreshToken),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          },
        },
        { session }
      );

      res.cookie("jwt", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 600000,
        sameSite: "strict",
      });

      res.cookie("jwt_refresh", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 604800000,
        sameSite: "strict",
        path: "/api/refresh",
      });

      await session.commitTransaction();

      res.redirect("/content");
    } catch (err) {
      await session.abortTransaction();
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.redirect("/log-in?error=google_failed"); // Fix the warning for frontend for this>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  } finally {
    if (session) await session.endSession();
  }
});

app.post("/sign-up", authLimiter, validateSignUp, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const data = req.body;
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpiresAt = new Date(
      new Date().getTime() + 24 * 60 * 60 * 1000
    );
    const exists = await User.findOne({ email: data.email }).session(session);

    if (exists) {
      throw new Error();
    }
    const salt = await bcrypt.genSalt(12);
    const hashedPass = await bcrypt.hash(data.password, salt);

    const accessToken = jwt.sign(
      { email: data.email },
      process.env.ACCESS_TOKEN_SECRET,
      {
        expiresIn: "10m",
      }
    );

    const refreshToken = jwt.sign(
      { email: data.email },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "7d" }
    );

    await User.create(
      [
        {
          email: data.email,
          name: data.name,
          passwordHash: hashedPass,
          refreshTokens: [
            {
              token: hashToken(refreshToken),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          ],
          veriToken: verificationToken,
          veriTokenExpiresAt: verificationTokenExpiresAt,
        },
      ],
      { session }
    );

    res.cookie("jwt", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 600000,
      sameSite: "strict",
    });

    res.cookie("jwt_refresh", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 604800000,
      sameSite: "strict",
      path: "/api/refresh",
    });
    await session.commitTransaction();
    res.sendStatus(201);
    try {
      await sendVeri(data.email, verificationToken, data.name);
    } catch (e) {
      console.error(e);
    }
  } catch (e) {
    console.error(e);
    await session.abortTransaction();
    res.sendStatus(500);
  } finally {
    await session.endSession();
  }
});

app.get("/log-in", async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const token = req.cookies.jwt;
    const receivedRefresh = req.cookies.jwt_refresh;
    if (token) {
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      await session.commitTransaction();
      res.redirect("/content");
    } else if (receivedRefresh) {
      const emailFromRefresh = jwt.verify(
        receivedRefresh,
        process.env.REFRESH_TOKEN_SECRET
      );

      const user = await User.findOne({
        "refreshTokens.token": hashToken(receivedRefresh),
        "refreshTokens.expiresAt": { $gt: new Date() },
      }).session(session);

      if (!user || emailFromRefresh.email !== user.email) {
        throw new Error();
      }

      const newAccessToken = jwt.sign(
        { email: emailFromRefresh.email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "10m" }
      );

      res.cookie("jwt", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 600000,
        sameSite: "strict",
      });

      const result = await User.updateOne(
        {
          email: emailFromRefresh.email,
          "refreshTokens.token": hashToken(receivedRefresh),
        },
        {
          $set: {
            "refreshTokens.$.expiresAt": new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000
            ),
          },
        },
        { session }
      );

      if (result.matchedCount === 0) {
        throw new Error();
      }

      res.cookie("jwt_refresh", receivedRefresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 604800000,
        sameSite: "strict",
        path: "/api/refresh",
      });
      await session.commitTransaction();
      res.redirect("/content");
    } else {
      await session.commitTransaction();
      return res.sendFile(path.join(__dirname, "..", "public", "log-in.html"));
    }
  } catch (e) {
    console.error(e);
    await session.abortTransaction();
    res.clearCookie("jwt");
    res.clearCookie("jwt_refresh", { path: "/api/refresh" });
    res.sendFile(path.join(__dirname, "..", "public", "log-in.html"));
  } finally {
    await session.endSession();
  }
});

app.post("/log-in", authLimiter, validateEmail, async (req, res) => {
  // Added validation
  const session = await mongoose.startSession();

  try {
    await session.startTransaction();
    const matches = await User.findOne({ email: req.body.email }).session(
      session
    );

    if (
      matches &&
      (await bcrypt.compare(req.body.password, matches.passwordHash))
    ) {
      const accessToken = jwt.sign(
        { email: matches.email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "10m",
        }
      );
      const refreshToken = jwt.sign(
        { email: matches.email },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: "7d" }
      );

      if (matches.refreshTokens.length > 0) {
        await User.updateOne(
          { email: matches.email },
          { $pull: { refreshTokens: { expiresAt: { $lte: new Date() } } } },
          { session }
        );
      }

      await User.updateOne(
        { email: matches.email },
        {
          $push: {
            refreshTokens: {
              token: hashToken(refreshToken),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          },
        },
        { session }
      );
      res.cookie("jwt", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 600000,
        sameSite: "strict",
      });

      res.cookie("jwt_refresh", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 604800000,
        sameSite: "strict",
        path: "/api/refresh",
      });
      await session.commitTransaction();
      res.sendStatus(200);
    } else {
      throw new Error();
    }
  } catch {
    await session.abortTransaction();
    res.sendStatus(401);
  } finally {
    await session.endSession();
  }
});

app.get("/api/refresh", async (req, res) => {
  const incomingRefreshToken = req.cookies.jwt_refresh;

  if (!incomingRefreshToken) {
    res.clearCookie("jwt");
    res.clearCookie("jwt_refresh", { path: "/api/refresh" });
    return res.sendStatus(401);
  }
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const emailSent = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const userObj = await User.findOne({
      refreshTokens: {
        $elemMatch: {
          token: hashToken(incomingRefreshToken),
          expiresAt: { $gt: new Date() },
        },
      },
    }).session(session);

    if (!userObj || emailSent.email !== userObj.email) {
      await session.abortTransaction();
      return res.sendStatus(403);
    }

    const newAccessToken = jwt.sign(
      { email: emailSent.email },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "10m" }
    );

    res.cookie("jwt", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 600000,
      sameSite: "strict",
    });

    await User.updateOne(
      {
        email: emailSent.email,
        "refreshTokens.token": hashToken(incomingRefreshToken),
      },
      {
        $set: {
          "refreshTokens.$.expiresAt": new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
          ),
        },
      },
      { session }
    );

    res.cookie("jwt_refresh", incomingRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 604800000,
      sameSite: "strict",
      path: "/api/refresh",
    });
    await session.commitTransaction();
    res.sendStatus(200);
  } catch {
    await session.abortTransaction();
    return res.sendStatus(403);
  } finally {
    await session.endSession();
  }
});

app.get("/api/refresh/logout", async (req, res) => {
  res.clearCookie("jwt");
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const refreshToken = req.cookies.jwt_refresh;
    res.clearCookie("jwt_refresh", { path: "/api/refresh" });
    if (refreshToken) {
      const obj = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

      await User.updateOne(
        { email: obj.email },
        {
          $pull: {
            refreshTokens: {
              token: hashToken(refreshToken),
            },
          },
        },
        { session }
      );

      await User.updateOne(
        { email: obj.email },
        { $pull: { refreshTokens: { expiresAt: { $lte: new Date() } } } },
        { session }
      );
    }
    await session.commitTransaction();
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    await session.abortTransaction();
    res.sendStatus(200);
  } finally {
    await session.endSession();
  }
});

app.get("/api/user-data", specialAuthToken, async (req, res) => {
  try {
    const user = req.user;
    res.json({
      email: user.email,
      name: user.name,
      authProvider: user.authProvider,
      verified: user.verified,
      contactEmail: process.env.EMAIL_APP,
      welcome: user.welcome,
      isDeactivated: user.isDeactivated,
      deleteAt: user.deleteAt,
      deviceId: user.deviceId || null,
      pairedAt: user.pairedAt || null,
    });
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

app.post(
  "/api/refresh/update-user-hints",
  specialAuthToken,
  async (req, res) => {
    try {
      if (req.body.welcome === false) {
        await User.updateOne(
          { email: req.user.email },
          { $set: { welcome: false } }
        );
      } else {
        return res.sendStatus(400);
      }
      res.sendStatus(200);
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
    }
  }
);

// Request a new pair token (for first-time pairing)
app.post(
  "/request-pair-token",
  authLimiter,
  specialAuthToken,
  async (req, res) => {
    try {
      const email = req.user.email;
      const deviceId = req.body.deviceId; // Note: camelCase to match frontend

      if (!deviceId) {
        return res.status(400).json({ error: "deviceId is required" });
      }

      // Check if user already has a paired device
      if (req.user.deviceId && req.user.deviceId !== deviceId) {
        return res.status(400).json({
          error: "already_paired",
          message: "You already have a paired device. Unpair it first.",
        });
      }

      // Check if this device is already paired to another user
      const existingPairing = await User.findOne({
        deviceId: deviceId,
        email: { $ne: email },
      });

      if (existingPairing) {
        return res.status(400).json({
          error: "device_registered",
          message: "This device is already registered to another account.",
        });
      }

      // Create the ES256 signed JWT token
      const pairToken = jwt.sign(
        {
          email: email,
          deviceId: deviceId,
          type: "pair",
        },
        privateKeyPem,
        { algorithm: "ES256" }
      );

      // Store the token temporarily (will be confirmed after ESP32 accepts it)
      await User.updateOne(
        { email: email },
        {
          $set: {
            pendingDeviceId: deviceId,
            pendingPairToken: pairToken,
            pendingPairAt: new Date(),
          },
        }
      );

      res.status(200).json({ pair_token: pairToken });
    } catch (e) {
      console.error("Request pair token error:", e);
      res.sendStatus(500);
    }
  }
);

// Confirm pairing (called after ESP32 accepts the token)
app.post("/confirm-pair", authLimiter, specialAuthToken, async (req, res) => {
  try {
    const email = req.user.email;
    const deviceId = req.body.deviceId;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    // Verify the pending pairing matches
    if (req.user.pendingDeviceId !== deviceId) {
      return res
        .status(400)
        .json({ error: "No pending pairing for this device" });
    }

    // Confirm the pairing
    await User.updateOne(
      { email: email },
      {
        $set: {
          deviceId: deviceId,
          pairToken: req.user.pendingPairToken,
          pairedAt: new Date(),
          isCalibrated: false,
        },
        $unset: {
          pendingDeviceId: "",
          pendingPairToken: "",
          pendingPairAt: "",
        },
      }
    );

    res.sendStatus(200);
  } catch (e) {
    console.error("Confirm pair error:", e);
    res.sendStatus(500);
  }
});

// Unpair device
app.post("/unpair-device", authLimiter, specialAuthToken, async (req, res) => {
  try {
    await User.updateOne(
      { email: req.user.email },
      {
        $unset: {
          deviceId: "",
          pairToken: "",
          pairedAt: "",
          isCalibrated: "",
          pendingDeviceId: "",
          pendingPairToken: "",
          pendingPairAt: "",
        },
      }
    );

    res.sendStatus(200);
  } catch (e) {
    console.error("Unpair device error:", e);
    res.sendStatus(500);
  }
});

// Get stored pair token (for reconnection)
app.get("/get-pair-token", specialAuthToken, async (req, res) => {
  try {
    if (!req.user.pairToken || !req.user.deviceId) {
      return res.status(404).json({ error: "No paired device" });
    }

    // Optionally verify the token is still valid
    try {
      jwt.verify(req.user.pairToken, publicKeyPem, { algorithms: ["ES256"] });
    } catch (tokenError) {
      // Token expired, generate a new one
      const newPairToken = jwt.sign(
        {
          email: req.user.email,
          deviceId: req.user.deviceId,
          type: "pair",
        },
        privateKeyPem,
        { algorithm: "ES256" }
      );

      await User.updateOne(
        { email: req.user.email },
        { $set: { pairToken: newPairToken } }
      );

      return res.status(200).json({ pair_token: newPairToken });
    }

    res.status(200).json({ pair_token: req.user.pairToken });
  } catch (e) {
    console.error("Get pair token error:", e);
    res.sendStatus(500);
  }
});

app.post("/request-reset", authLimiter, validateEmail, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const userObj = await User.findOne({ email: req.body.email }).session(
      session
    );

    if (!userObj || userObj.authProvider === "google" || !userObj.verified) {
      await session.abortTransaction();
      return res.sendStatus(200);
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    await User.updateOne(
      { email: req.body.email },
      {
        passChangeToken: {
          token: resetToken,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
      { session }
    );

    await sendReset(req.body.email, resetToken, userObj.name);
    await session.commitTransaction();
    res.sendStatus(200);
  } catch (e) {
    await session.abortTransaction();
    res.sendStatus(200);
  } finally {
    await session.endSession();
  }
});

app.post("/change-pass", authLimiter, validatePass, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const newPassword = req.body.password;
    const tokenUser = req.body.token;
    const userObj = await User.findOne({
      "passChangeToken.token": tokenUser,
      "passChangeToken.expiresAt": { $gt: new Date() },
    }).session(session);

    if (
      !userObj ||
      !userObj.passwordHash ||
      userObj.authProvider === "google"
    ) {
      await session.abortTransaction();
      throw new Error();
    }

    const isMatch = await bcrypt.compare(newPassword, userObj.passwordHash);
    if (isMatch) {
      await session.abortTransaction();
      throw new Error("samePassword");
    }

    const salt = await bcrypt.genSalt(12);
    const hashedNewPass = await bcrypt.hash(newPassword, salt);
    await User.updateOne(
      { email: userObj.email },
      {
        passwordHash: hashedNewPass,
        passChangeToken: { token: null, expiresAt: null },
        refreshTokens: [], // Invalidate ALL sessions
      },
      { session }
    );
    await session.commitTransaction();
    res.clearCookie("jwt");
    res.clearCookie("jwt_refresh", { path: "/api/refresh" });
    res.sendStatus(200);
  } catch (e) {
    await session.abortTransaction();
    if (e.message === "samePassword") {
      // The same password as old
      res.sendStatus(403);
    } else {
      // Error - a Google user or wrong token
      res.sendStatus(500);
    }
  } finally {
    await session.endSession();
  }
});

app.get("/verify-email", authLimiter, async (req, res) => {
  try {
    const token = req.query.token;
    if (token) {
      const updateOperation = await User.findOneAndUpdate(
        {
          veriToken: token,
          verified: false,
          veriTokenExpiresAt: { $gt: new Date() },
        },
        { verified: true, veriToken: null, veriTokenExpiresAt: null }
      );
      if (updateOperation) {
        return res.redirect("/content");
      } else {
        throw new Error();
      }
    } else {
      throw new Error();
    }
  } catch (e) {
    res.status(404).sendFile(path.join(__dirname, "..", "public", "404.html"));
  }
});

app.post(
  "/resend-verification-public",
  authLimiter,
  validateEmail,
  async (req, res) => {
    try {
      const userInfo = await User.findOne({ email: req.body.email });
      if (!userInfo) {
        return res.sendStatus(200);
      }

      if (userInfo.verified) {
        return res.sendStatus(200);
      }

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationTokenExpiresAt = new Date(
        new Date().getTime() + 24 * 60 * 60 * 1000
      );
      await User.updateOne(
        { email: req.body.email },
        {
          $set: {
            veriToken: verificationToken,
            veriTokenExpiresAt: verificationTokenExpiresAt,
          },
        }
      );
      await sendVeri(userInfo.email, verificationToken, userInfo.name);
      res.sendStatus(200);
    } catch {
      return res.sendStatus(200);
    }
  }
);

app.post(
  "/resend-verification",
  authLimiter,
  specialAuthToken,
  async (req, res) => {
    try {
      if (req.user.verified) {
        return res.sendStatus(400);
      }
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationTokenExpiresAt = new Date(
        new Date().getTime() + 24 * 60 * 60 * 1000
      );
      await User.updateOne(
        { email: req.user.email },
        {
          $set: {
            veriToken: verificationToken,
            veriTokenExpiresAt: verificationTokenExpiresAt,
          },
        }
      );
      await sendVeri(req.user.email, verificationToken, req.user.name);
      res.sendStatus(200);
    } catch (e) {
      console.error(e);
      return res.sendStatus(500);
    }
  }
);

app.post("/api/refresh/feedback", specialAuthToken, async (req, res) => {
  const data = req.body;

  if (!data.type || (data.type === "other" && !data.details)) {
    return res.sendStatus(400);
  }

  const feedbackTicket = await Feedback.create({
    type: data.type,
    details: data.details ? data.details : null,
    email: data.email,
  });

  if (feedbackTicket) {
    res.sendStatus(200);
  } else {
    res.sendStatus(500);
  }
});

app.post(
  "/api/refresh/update-name",
  specialAuthToken,
  validateName,
  async (req, res) => {
    if (!req.user.verified) {
      return res.sendStatus(401);
    }
    try {
      const email = req.user.email;
      const name = req.body.name;
      await User.updateOne({ email: email }, { $set: { name: name } });
      res.sendStatus(200);
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
    }
  }
);

app.delete("/delete-account", specialAuthToken, async (req, res) => {
  if (!req.user.verified) {
    return res.sendStatus(401);
  }
  try {
    const deleteAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days

    await sendDeletionWarning(req.user.email, req.user.name, deleteAt);

    await User.updateOne(
      { email: req.user.email },
      {
        $set: {
          deletionRequestedAt: new Date(),
          deleteAt: deleteAt,
          isDeactivated: true,
        },
      }
    );
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(403);
  }
});

app.post("/api/refresh/cancel-deletion", specialAuthToken, async (req, res) => {
  try {
    await User.updateOne(
      { email: req.user.email },
      {
        $set: {
          deletionRequestedAt: null,
          deleteAt: null,
          isDeactivated: false,
        },
      }
    );

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// Static routes:

app.get("/resend-verification", (req, res) => {
  res.sendFile(
    path.join(__dirname, "..", "public", "resend-verification.html")
  );
});

app.get("/forgot-password", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "forgot-password.html"));
});

app.get("/sign-up", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "sign-up.html"));
});

app.get("/change-pass", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "password-change.html"));
});

app.get("/content", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "app.html"));
});

// Pre 404:

app.get("/health", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (e) {
    console.error(e);
    res.status(503).json({ status: "unhealthy" });
  }
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

// Unknown page handler:

app.use((req, res) => {
  res
    .status(404)
    .sendFile(path.join(__dirname, "..", "public", "404.html"), (err) => {
      if (err) {
        res.status(404).send("Page not found");
      }
    });
});

// Functions:

function startDeletionCron() {
  // Run every hour
  cron.schedule("0 * * * *", async () => {
    try {
      const usersToDelete = await User.find({
        deleteAt: { $lte: new Date() },
        isDeactivated: true,
      })
        .limit(100)
        .lean();

      if (usersToDelete.length === 0) {
        return;
      }

      for (const user of usersToDelete) {
        try {
          // Delete Stripe customer first (cancels subscriptions too)
          if (user.stripeCustomerId) {
            try {
              await stripe.customers.del(user.stripeCustomerId);
            } catch (stripeErr) {
              console.error(
                `Stripe deletion failed for ${user.email}:`,
                stripeErr.message
              );
            }
          }

          // Delete user from database
          await User.deleteOne({ _id: user._id });

          console.log(`Deleted account: ${user.email}`);
        } catch (e) {
          console.error(`Failed to delete ${user.email}:`, e);
        }
      }
    } catch (e) {
      console.error("Deletion job error:", e);
    }
  });
}

async function sendDeletionWarning(userEmail, userName, deleteDate) {
  const loginLink = `${URL}/log-in`;
  const formattedDate = new Date(deleteDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const mailOptions = {
    from: `"Header App" <${process.env.EMAIL_APP}>`,
    to: userEmail,
    subject: "Your Header account is scheduled for deletion",
    html: `
      <!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Account Deletion Warning | Header</title>
  </head>
  <body
    style="
      margin: 0;
      padding: 0;
      background-color: #f4f7fa;
      font-family: 'Segoe UI', Arial, sans-serif;
    "
  >
    <!-- Wrapper -->
    <table
      role="presentation"
      width="100%"
      cellspacing="0"
      cellpadding="0"
      style="background-color: #f4f7fa; padding: 40px 20px"
    >
      <tr>
        <td align="center">
          <!-- Main Container -->
          <table
            role="presentation"
            width="600"
            cellspacing="0"
            cellpadding="0"
            style="
              background-color: #ffffff;
              border-radius: 16px;
              overflow: hidden;
              box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
            "
          >
            <!-- Header with Warning Theme -->
            <tr>
              <td
                style="
                  background-color: #0f172a;
                  padding: 40px 40px;
                  text-align: center;
                  position: relative;
                "
              >
                <!-- Logo -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 24px auto"
                >
                  <tr>
                    <td>
                      <img
  src="https://header.news/logo.png"
  alt="Header"
  width="200"
  style="display:block"
/>
                    </td>
                  </tr>
                </table>

                <h1
                  style="
                    color: #ffffff;
                    margin: 0;
                    font-size: 24px;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                  "
                >
                  Your account is scheduled for deletion
                </h1>
                <p
                  style="
                    color: rgba(255, 255, 255, 0.7);
                    margin: 12px 0 0 0;
                    font-size: 15px;
                  "
                >
                  Action required if you want to keep your account
                </p>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding: 48px 40px">
                <!-- Greeting -->
                <p
                  style="
                    color: #0f172a;
                    font-size: 17px;
                    margin: 0 0 20px 0;
                    line-height: 1.6;
                  "
                >
                  Hi <strong>${userName}</strong>,
                </p>

                <p
                  style="
                    color: #64748b;
                    font-size: 15px;
                    margin: 0 0 24px 0;
                    line-height: 1.7;
                  "
                >
                  We received a request to delete your Header account. Your
                  account and all associated data will be
                  <strong>permanently deleted</strong> on:
                </p>

                <!-- Deletion Date Box -->
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 0 32px 0"
                >
                  <tr>
                    <td
                      style="
                        background-color: #fef2f2;
                        border: 1px solid #fecaca;
                        border-radius: 12px;
                        padding: 20px;
                        text-align: center;
                      "
                    >
                      <p
                        style="
                          color: #991b1b;
                          font-size: 13px;
                          font-weight: 600;
                          margin: 0 0 8px 0;
                          text-transform: uppercase;
                          letter-spacing: 0.5px;
                        "
                      >
                        Scheduled Deletion Date
                      </p>
                      <p
                        style="
                          color: #dc2626;
                          font-size: 20px;
                          font-weight: 700;
                          margin: 0;
                        "
                      >
                        ${formattedDate}
                      </p>
                    </td>
                  </tr>
                </table>

                <!-- What will be deleted -->
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  style="
                    background-color: #f8fafc;
                    border-radius: 12px;
                    margin-bottom: 32px;
                  "
                >
                  <tr>
                    <td style="padding: 24px">
                      <p
                        style="
                          color: #0f172a;
                          font-size: 14px;
                          font-weight: 600;
                          margin: 0 0 16px 0;
                        "
                      >
                        What will be permanently deleted:
                      </p>
                      <table
                        role="presentation"
                        cellspacing="0"
                        cellpadding="0"
                      >
                        <tr>
                          <td style="padding: 6px 0">
                            <span style="color: #dc2626; margin-right: 10px"
                              >✕</span
                            >
                            <span style="color: #64748b; font-size: 14px"
                              >All your saved articles</span
                            >
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 6px 0">
                            <span style="color: #dc2626; margin-right: 10px"
                              >✕</span
                            >
                            <span style="color: #64748b; font-size: 14px"
                              >Your reading preferences and history</span
                            >
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 6px 0">
                            <span style="color: #dc2626; margin-right: 10px"
                              >✕</span
                            >
                            <span style="color: #64748b; font-size: 14px"
                              >Active subscriptions (no refunds)</span
                            >
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 6px 0">
                            <span style="color: #dc2626; margin-right: 10px"
                              >✕</span
                            >
                            <span style="color: #64748b; font-size: 14px"
                              >Your account and login credentials</span
                            >
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Changed your mind section -->
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  style="
                    background-color: #f0fdf4;
                    border: 1px solid #bbf7d0;
                    border-radius: 12px;
                    margin-bottom: 32px;
                  "
                >
                  <tr>
                    <td style="padding: 24px">
                      <p
                        style="
                          color: #166534;
                          font-size: 15px;
                          font-weight: 600;
                          margin: 0 0 12px 0;
                        "
                      >
                        Changed your mind?
                      </p>
                      <p
                        style="
                          color: #15803d;
                          font-size: 14px;
                          margin: 0;
                          line-height: 1.6;
                        "
                      >
                        You can cancel the deletion anytime before the scheduled
                        date. Simply log in to your account and click "Cancel
                        Deletion" on the deletion notice page.
                      </p>
                    </td>
                  </tr>
                </table>

                <!-- CTA Button -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 32px auto"
                >
                  <tr>
                    <td
                      align="center"
                      style="background-color: #0f172a; border-radius: 12px"
                    >
                      <a
                        href="${loginLink}"
                        target="_blank"
                        style="
                          display: inline-block;
                          padding: 16px 48px;
                          color: #ffffff;
                          font-size: 15px;
                          font-weight: 600;
                          text-decoration: none;
                        "
                      >
                        Log in to cancel deletion →
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- Alternative Link -->
                <p style="color: #94a3b8; font-size: 13px; margin: 0 0 10px 0">
                  Button not working? Copy and paste this link:
                </p>
                <p
                  style="
                    background-color: #f1f5f9;
                    padding: 12px 14px;
                    border-radius: 8px;
                    word-break: break-all;
                    margin: 0 0 32px 0;
                  "
                >
                  <a
                    href="${loginLink}"
                    style="
                      color: #2563eb;
                      font-size: 12px;
                      text-decoration: none;
                    "
                  >
                    ${loginLink}
                  </a>
                </p>

                <!-- Divider -->
                <hr
                  style="
                    border: none;
                    border-top: 1px solid #e2e8f0;
                    margin: 32px 0;
                  "
                />

                <!-- Security Notice -->
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                >
                  <tr>
                    <td style="padding: 0">
                      <p
                        style="
                          color: #94a3b8;
                          font-size: 13px;
                          margin: 0;
                          line-height: 1.6;
                        "
                      >
                        <strong style="color: #64748b"
                          >Didn't request this?</strong
                        ><br />
                        If you didn't request account deletion, please log in
                        immediately and cancel the deletion. Then change your
                        password to secure your account. If you need help,
                        contact us at
                        <a
                          href="mailto:${process.env.EMAIL_APP}"
                          style="color: #2563eb; text-decoration: none"
                          >${process.env.EMAIL_APP}</a
                        >.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td
                style="
                  background-color: #0f172a;
                  padding: 32px 40px;
                  text-align: center;
                "
              >
                <!-- Logo in footer -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 16px auto"
                >
                  <tr>
                    <td>
                      <img
  src="https://header.news/logo.png"
  alt="Header"
  width="200"
  style="display:block"
/>
                    </td>
                  </tr>
                </table>

                <p
                  style="
                    color: rgba(255, 255, 255, 0.5);
                    font-size: 13px;
                    margin: 0 0 8px 0;
                    line-height: 1.6;
                  "
                >
                  AI-powered news summaries for busy professionals and casuals
                </p>

                <p
                  style="
                    color: rgba(255, 255, 255, 0.3);
                    font-size: 11px;
                    margin: 16px 0 0 0;
                  "
                >
                  © 2025 Header News. All rights reserved.
                </p>
              </td>
            </tr>
          </table>

          <!-- Bottom note -->
          <p
            style="
              color: #94a3b8;
              font-size: 11px;
              margin: 20px 0 0 0;
              text-align: center;
            "
          >
            This is an automated email regarding your account deletion request.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>

    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (e) {
    console.error("Deletion warning email failed:", e);
    throw new Error();
  }
}

async function startServer() {
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  startDeletionCron();

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down...`);

    server.close(async () => {
      await mongoose.connection.close();
      console.log("Server closed");
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Database connected!\n");
  } catch (e) {
    console.error("MongoDB connection failed", e);
    process.exit(1);
  }
}

async function specialAuthToken(req, res, next) {
  const token = req.cookies.jwt;
  const refreshToken = req.cookies.jwt_refresh;
  try {
    if (token) {
      const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      const userStartObj = await User.findOne({ email: payload.email });
      if (!userStartObj) {
        res.clearCookie("jwt");
        res.clearCookie("jwt_refresh", { path: "/api/refresh" });
        return res.redirect("/log-in");
      }
      req.user = userStartObj;
      return next();
    }
    if (refreshToken) {
      const emailSent = jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET
      );
      const session = await mongoose.startSession();
      try {
        await session.startTransaction();

        const userObj = await User.findOne({
          refreshTokens: {
            $elemMatch: {
              token: hashToken(refreshToken),
              expiresAt: { $gt: new Date() },
            },
          },
        }).session(session);

        if (!userObj || !(emailSent.email === userObj.email)) {
          res.clearCookie("jwt");
          res.clearCookie("jwt_refresh", { path: "/api/refresh" });
          await session.abortTransaction();
          return res.sendStatus(403); // Go to log in
        }

        const newAccessToken = jwt.sign(
          { email: emailSent.email },
          process.env.ACCESS_TOKEN_SECRET,
          { expiresIn: "10m" }
        );

        res.cookie("jwt", newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 600000,
          sameSite: "strict",
        });

        await User.updateOne(
          {
            email: emailSent.email,
            "refreshTokens.token": hashToken(refreshToken),
          },
          {
            $set: {
              "refreshTokens.$.expiresAt": new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000
              ),
            },
          },
          { session }
        );

        res.cookie("jwt_refresh", refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 604800000,
          sameSite: "strict",
          path: "/api/refresh",
        });
        await session.commitTransaction();
        req.user = userObj;
        return next();
      } catch {
        await session.abortTransaction();
        res.clearCookie("jwt");
        res.clearCookie("jwt_refresh", { path: "/api/refresh" });
        return res.sendStatus(403); // Go to log in
      } finally {
        await session.endSession();
      }
    } else {
      return res.sendStatus(403); // Go to log in/trigger loading screen
    }
  } catch {
    res.clearCookie("jwt");
    res.clearCookie("jwt_refresh", { path: "/api/refresh" });
    return res.sendStatus(403); // Redirect to log in
  }
}

async function sendVeri(userEmail, token, userName) {
  const verificationLink = `${URL}/verify-email?token=${token}`;
  const mailOptions = {
    from: `"Header App" <${process.env.EMAIL_APP}>`,
    to: userEmail,
    subject: "Verify your Header account",
    html: `
      <!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Verify Your Email | Header</title>
  </head>
  <body
    style="
      margin: 0;
      padding: 0;
      background-color: #f4f7fa;
      font-family: 'Segoe UI', Arial, sans-serif;
    "
  >
    <!-- Wrapper -->
    <table
      role="presentation"
      width="100%"
      cellspacing="0"
      cellpadding="0"
      style="background-color: #f4f7fa; padding: 40px 20px"
    >
      <tr>
        <td align="center">
          <!-- Main Container -->
          <table
            role="presentation"
            width="600"
            cellspacing="0"
            cellpadding="0"
            style="
              background-color: #ffffff;
              border-radius: 16px;
              overflow: hidden;
              box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
            "
          >
            <!-- Header with Dark Theme -->
            <tr>
              <td
                style="
                  background-color: #0f172a;
                  padding: 40px 40px;
                  text-align: center;
                  position: relative;
                "
              >
                <!-- Logo -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 24px auto"
                >
                  <tr>
                    <td>
                      <img
  src="https://header.news/logo.png"
  alt="Header"
  width="200"
  style="display:block"
/>
                    </td>
                  </tr>
                </table>

                <h1
                  style="
                    color: #ffffff;
                    margin: 0;
                    font-size: 24px;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                  "
                >
                  Verify your email address
                </h1>
                <p
                  style="
                    color: rgba(255, 255, 255, 0.7);
                    margin: 12px 0 0 0;
                    font-size: 15px;
                  "
                >
                  You're one step away from your personalized news feed
                </p>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding: 48px 40px">
                <!-- Greeting -->
                <p
                  style="
                    color: #0f172a;
                    font-size: 17px;
                    margin: 0 0 20px 0;
                    line-height: 1.6;
                  "
                >
                  Hi <strong>${userName}</strong>,
                </p>

                <p
                  style="
                    color: #64748b;
                    font-size: 15px;
                    margin: 0 0 32px 0;
                    line-height: 1.7;
                  "
                >
                  Thanks for signing up for Header! To start receiving your
                  personalized AI news summaries, please verify your email
                  address by clicking the button below.
                </p>

                <!-- CTA Button -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 32px auto"
                >
                  <tr>
                    <td
                      align="center"
                      style="background-color: #0f172a; border-radius: 12px"
                    >
                      <a
                        href="${verificationLink}"
                        target="_blank"
                        style="
                          display: inline-block;
                          padding: 16px 48px;
                          color: #ffffff;
                          font-size: 15px;
                          font-weight: 600;
                          text-decoration: none;
                        "
                      >
                        Verify my email →
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- What you'll get -->
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  style="
                    background-color: #f8fafc;
                    border-radius: 12px;
                    margin-bottom: 32px;
                  "
                >
                  <tr>
                    <td style="padding: 24px">
                      <p
                        style="
                          color: #0f172a;
                          font-size: 14px;
                          font-weight: 600;
                          margin: 0 0 16px 0;
                        "
                      >
                        Some notes to keep your account safe:
                      </p>
                      <table
                        role="presentation"
                        cellspacing="0"
                        cellpadding="0"
                      >
                        <tr>
                          <td style="padding: 6px 0">
                            <span style="color: #2563eb; margin-right: 10px"
                              >⏰</span
                            >
                            <span style="color: #64748b; font-size: 14px"
                              >This link expires in 24 hours.</span
                            >
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Alternative Link -->
                <p style="color: #94a3b8; font-size: 13px; margin: 0 0 10px 0">
                  Button not working? Copy and paste this link:
                </p>
                <p
                  style="
                    background-color: #f1f5f9;
                    padding: 12px 14px;
                    border-radius: 8px;
                    word-break: break-all;
                    margin: 0 0 32px 0;
                  "
                >
                  <a
                    href="${verificationLink}"
                    style="
                      color: #2563eb;
                      font-size: 12px;
                      text-decoration: none;
                    "
                  >
                    ${verificationLink}
                  </a>
                </p>

                <!-- Divider -->
                <hr
                  style="
                    border: none;
                    border-top: 1px solid #e2e8f0;
                    margin: 32px 0;
                  "
                />

                <!-- Security Notice -->
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                >
                  <tr>
                    <td style="padding: 0">
                      <p
                        style="
                          color: #94a3b8;
                          font-size: 13px;
                          margin: 0;
                          line-height: 1.6;
                        "
                      >
                        <strong style="color: #64748b"
                          >Didn't sign up for Header?</strong
                        ><br />
                        No worries — just ignore this email and your address
                        won't be used.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td
                style="
                  background-color: #0f172a;
                  padding: 32px 40px;
                  text-align: center;
                "
              >
                <!-- Logo in footer -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 16px auto"
                >
                  <tr>
                    <td>
                      <img
  src="https://header.news/logo.png"
  alt="Header"
  width="200"
  style="display:block"
/>
                    </td>
                  </tr>
                </table>

                <p
                  style="
                    color: rgba(255, 255, 255, 0.5);
                    font-size: 13px;
                    margin: 0 0 8px 0;
                    line-height: 1.6;
                  "
                >
                  AI-powered news summaries for busy professionals and casuals
                </p>

                <p
                  style="
                    color: rgba(255, 255, 255, 0.3);
                    font-size: 11px;
                    margin: 16px 0 0 0;
                  "
                >
                  © 2025 Header News. All rights reserved.
                </p>
              </td>
            </tr>
          </table>

          <!-- Bottom note -->
          <p
            style="
              color: #94a3b8;
              font-size: 11px;
              margin: 20px 0 0 0;
              text-align: center;
            "
          >
            This is a one-time verification email from Header.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>

    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (e) {
    console.error(e);
    throw new Error();
  }
}

async function sendReset(userEmail, resetToken, userName) {
  const resetLink = `${URL}/change-pass?token=${resetToken}`;
  const mailOptions = {
    from: `"Header App" <${process.env.EMAIL_APP}>`,
    to: userEmail,
    subject: "Password Change on Header",
    html: `
      <!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Password Change Request | Header</title>
  </head>
  <body
    style="
      margin: 0;
      padding: 0;
      background-color: #f4f7fa;
      font-family: 'Segoe UI', Arial, sans-serif;
    "
  >
    <!-- Wrapper -->
    <table
      role="presentation"
      width="100%"
      cellspacing="0"
      cellpadding="0"
      style="background-color: #f4f7fa; padding: 40px 20px"
    >
      <tr>
        <td align="center">
          <!-- Main Container -->
          <table
            role="presentation"
            width="600"
            cellspacing="0"
            cellpadding="0"
            style="
              background-color: #ffffff;
              border-radius: 16px;
              overflow: hidden;
              box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
            "
          >
            <tr>
              <td
                style="
                  background-color: #0f172a;
                  padding: 40px 40px;
                  text-align: center;
                  position: relative;
                "
              >
                <!-- Logo -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 24px auto"
                >
                  <tr>
                    <td>
                      <img
  src="https://header.news/logo.png"
  alt="Header"
  width="200"
  style="display:block"
/>
                    </td>
                  </tr>
                </table>

                <h1
                  style="
                    color: #ffffff;
                    margin: 0;
                    font-size: 24px;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                  "
                >
                  Requested Password Change
                </h1>
                <p
                  style="
                    color: rgba(255, 255, 255, 0.7);
                    margin: 12px 0 0 0;
                    font-size: 15px;
                  "
                >
                  Lost or forgot your password? Let's change it!
                </p>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding: 48px 40px">
                <!-- Greeting -->
                <p
                  style="
                    color: #0f172a;
                    font-size: 17px;
                    margin: 0 0 20px 0;
                    line-height: 1.6;
                  "
                >
                  Hi <strong>${userName}</strong>,
                </p>

                <p
                  style="
                    color: #64748b;
                    font-size: 15px;
                    margin: 0 0 32px 0;
                    line-height: 1.7;
                  "
                >
                  We have received your request to change your password. Please
                  click the button below to confirm this action and enter your
                  new password.
                </p>

                <!-- CTA Button -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 32px auto"
                >
                  <tr>
                    <td
                      align="center"
                      style="background-color: #0f172a; border-radius: 12px"
                    >
                      <a
                        href="${resetLink}"
                        target="_blank"
                        style="
                          display: inline-block;
                          padding: 16px 48px;
                          color: #ffffff;
                          font-size: 15px;
                          font-weight: 600;
                          text-decoration: none;
                        "
                      >
                        Change password →
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- Alternative Link -->
                <p style="color: #94a3b8; font-size: 13px; margin: 0 0 10px 0">
                  Button not working? Copy and paste this link:
                </p>
                <p
                  style="
                    background-color: #f1f5f9;
                    padding: 12px 14px;
                    border-radius: 8px;
                    word-break: break-all;
                    margin: 0 0 32px 0;
                  "
                >
                  <a
                    href="${resetLink}"
                    style="
                      color: #2563eb;
                      font-size: 12px;
                      text-decoration: none;
                    "
                  >
                    ${resetLink}
                  </a>
                </p>

                <!-- Divider -->
                <hr
                  style="
                    border: none;
                    border-top: 1px solid #e2e8f0;
                    margin: 32px 0;
                  "
                />

                <!-- Security Notice -->
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                >
                  <tr>
                    <td style="padding: 0">
                      <p
                        style="
                          color: #94a3b8;
                          font-size: 13px;
                          margin: 0;
                          line-height: 1.6;
                        "
                      >
                        <strong style="color: #64748b"
                          >This email expires in 1 hour.</strong
                        ><br />
                        Please retry if expires.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td
                style="
                  background-color: #0f172a;
                  padding: 32px 40px;
                  text-align: center;
                "
              >
                <!-- Logo in footer -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  style="margin: 0 auto 16px auto"
                >
                  <tr>
                    <td>
                      <img
  src="https://header.news/logo.png"
  alt="Header"
  width="200"
  style="display:block"
/>
                    </td>
                  </tr>
                </table>

                <p
                  style="
                    color: rgba(255, 255, 255, 0.5);
                    font-size: 13px;
                    margin: 0 0 8px 0;
                    line-height: 1.6;
                  "
                >
                  AI-powered news summaries for busy professionals and casuals
                </p>

                <p
                  style="
                    color: rgba(255, 255, 255, 0.3);
                    font-size: 11px;
                    margin: 16px 0 0 0;
                  "
                >
                  © 2025 Header News. All rights reserved.
                </p>
              </td>
            </tr>
          </table>

          <!-- Bottom note -->
          <p
            style="
              color: #94a3b8;
              font-size: 11px;
              margin: 20px 0 0 0;
              text-align: center;
            "
          >
            This is an email to reset your password from Header.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (e) {
    console.error(e);
    throw new Error();
  }
}

// The server launces here

await startServer();
