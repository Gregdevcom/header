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
import Stripe from "stripe";
import {
  ArticleEN,
  ArchiveEN,
  ArticleNL,
  ArchiveNL,
  User,
  Feedback,
} from "./mainSchemas.js";
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
  "STRIPE_SECRET",
  "STRIPE_PUBLIC",
  "STRIPE_WEBHOOKS_LOCAL",
  "STRIPE_PRICE_EVERYDAY_MONTHLY",
  "STRIPE_PRICE_EVERYDAY_YEARLY",
  "TRIAL_DAYS",
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
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
                "https://js.stripe.com",
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
              imgSrc: [
                "'self'",
                "data:",
                "https:",
                "https://*.stripe.com",
                "https://cdn.jsdelivr.net",
              ],
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
                "https://api.stripe.com",
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
              ],
              frameSrc: [
                "'self'",
                "https://js.stripe.com",
                "https://hooks.stripe.com",
              ],
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

const stripe = new Stripe(process.env.STRIPE_SECRET);

// Price ID mapping
const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_EVERYDAY_MONTHLY]: "everyday",
  [process.env.STRIPE_PRICE_EVERYDAY_YEARLY]: "everyday",
};

const PLAN_TO_PRICE = {
  everydayMonthly: process.env.STRIPE_PRICE_EVERYDAY_MONTHLY,
  everydayYearly: process.env.STRIPE_PRICE_EVERYDAY_YEARLY,
};

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS);

// Stripe webhook - needs raw body (MUST be before express.json())
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOKS_LOCAL
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.sendStatus(400);
    }
    res.sendStatus(200);
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          await handleCheckoutComplete(session);
          break;
        }

        case "customer.subscription.created": {
          const subscription = event.data.object;
          await handleSubscriptionCreated(subscription);
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;
          await handleSubscriptionUpdate(subscription);
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          await handleSubscriptionCanceled(subscription);
          break;
        }

        case "customer.subscription.trial_will_end": {
          // Fires 3 days before trial ends
          const subscription = event.data.object;
          await handleTrialEnding(subscription);
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;
          await handlePaymentFailed(invoice);
          break;
        }

        case "invoice.paid":
        case "invoice.payment_succeeded": {
          const invoice = event.data.object;
          await handlePaymentSucceeded(invoice);
          break;
        }
      }
    } catch (err) {
      console.error("Webhook handler error:", err);
    }
  }
);

app.use(express.json());

app.use(cookieParser());

app.use(generalLimiter);

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const cacheKey = `news:today`;

const cacheEN = new NodeCache({
  stdTTL: 300,
  checkperiod: 600,
  useClones: false,
});

const cacheNL = new NodeCache({
  stdTTL: 300,
  checkperiod: 600,
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
      session.startTransaction();
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
      } else {
        await User.updateOne(
          { email: googleEmail },
          {
            $set: {
              name: googleName,
              authProvider: "google",
              verified: true,
              passwordHash: null,
            },
          },
          { session }
        );
      }

      const accessToken = jwt.sign(
        { email: googleEmail },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "10m" }
      );

      const refreshToken = jwt.sign(
        { email: googleEmail },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: "30d" }
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
    res.redirect("/log-in?error=google_failed"); // Add a warning for frontend for this>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  } finally {
    if (session) await session.endSession();
  }
});

app.post("/sign-up", authLimiter, validateSignUp, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
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
      { expiresIn: "30d" }
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

app.post("/log-in", authLimiter, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
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
        { expiresIn: "30d" }
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
    session.startTransaction();
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
    const contentLang = user.selectedContentLanguage || "en";
    const userPlan = user.plan;
    let cachedArticles;
    let articlesDB;
    if (contentLang === "en") {
      cachedArticles = cacheEN.get(cacheKey);
      if (!cachedArticles) {
        articlesDB = await ArticleEN.find({}).lean();
        if (articlesDB) {
          cachedArticles = articlesDB;
          cacheEN.set(cacheKey, cachedArticles);
        } else {
          cachedArticles = null;
        }
      }
    } else {
      cachedArticles = cacheNL.get(cacheKey);
      if (!cachedArticles) {
        articlesDB = await ArticleNL.find({}).lean();
        if (articlesDB) {
          cachedArticles = articlesDB;
          cacheNL.set(cacheKey, cachedArticles);
        } else {
          cachedArticles = null;
        }
      }
    }
    let cachedArticlesUpdated = [];

    if (userPlan === "free") {
      if (cachedArticles && cachedArticles.length > 5) {
        for (const cachedArticle of cachedArticles) {
          if (cachedArticlesUpdated.length > 4) {
            break;
          }
          cachedArticlesUpdated.push({
            ...cachedArticle,
            qualityScoreAI: null,
            biasScoreAI: null,
          });
        }
      }
    }
    res.json({
      email: user.email,
      name: user.name,
      authProvider: user.authProvider,
      verified: user.verified,
      articles: user.plan === "free" ? cachedArticlesUpdated : cachedArticles,
      lang: contentLang,
      secretInfo: user.plan, // User's plan
      subscription: user.subscription
        ? {
            // User's subscription info
            status: user.subscription.status,
            currentPeriodEnd: user.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
            trialEnd: user.subscription.trialEnd,
            priceId: user.subscription.priceId,
            isTrialing: user.subscription.status === "trialing",
          }
        : null,
      canStartTrial: !user.hasUsedTrial,
      contactEmail: process.env.EMAIL_APP,
      welcome: user.welcome,
    });
  } catch (e) {
    console.log(e);
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

app.post("/api/refresh/save-article", specialAuthToken, async (req, res) => {
  const userEmail = req.user.email;
  const contentLang = req.user.selectedContentLanguage || "en";
  const userEmail02 = req.body.email;
  const ArtId = req.body.artId;
  const action = req.body.action;

  if (userEmail !== userEmail02) {
    res.clearCookie("jwt");
    res.clearCookie("jwt_refresh", { path: "/api/refresh" });
    return res.redirect("/log-in");
  }

  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    // 1 = favorite, 2 = unfavorite
    if (action === 1) {
      if (req.user.plan === "free" && req.user.savedArticles.length > 2) {
        await session.abortTransaction();
        return res.sendStatus(405); // user cannot save more than 3 articles!
      }
      let artObj;
      if (contentLang === "en") {
        artObj = await ArticleEN.findOne({ _id: ArtId })
          .lean()
          .session(session);
      } else {
        artObj = await ArticleNL.findOne({ _id: ArtId })
          .lean()
          .session(session);
      }

      if (!artObj) {
        await session.abortTransaction();
        return res.sendStatus(404); // No article found
      }
      const userSearch = await User.findOne({
        email: userEmail,
        "savedArticles._id": ArtId,
      }).session(session);
      if (userSearch) {
        await session.abortTransaction();
        return res.sendStatus(409); // Article already saved by user
      }

      await User.updateOne(
        { email: userEmail },
        { $push: { savedArticles: artObj } },
        { session }
      );
      await session.commitTransaction();
      return res.sendStatus(200);
    } else if (action === 2) {
      await User.updateOne(
        { email: userEmail },
        { $pull: { savedArticles: { _id: ArtId } } },
        { session }
      );
      await session.commitTransaction();
      return res.sendStatus(200); // All good, action completed
    } else {
      await session.abortTransaction();
      return res.sendStatus(400); // Invalid frontend action
    }
  } catch (e) {
    console.error(e);
    await session.abortTransaction();
    res.sendStatus(500); // Unexpected error
  } finally {
    await session.endSession();
  }
});

app.get("/api/refresh/load-stars", specialAuthToken, async (req, res) => {
  try {
    if (req.user.savedArticles.length === 0) {
      return res.sendStatus(404);
    }
    if (req.user.plan !== "free") {
      return res.status(200).json({ savedArticles: req.user.savedArticles });
    } else {
      let savedArticleArray = [];
      for (const article of req.user.savedArticles) {
        savedArticleArray.push({
          ...article.toObject(), // Convert mongoose doc to plain object
          biasScoreAI: null,
          qualityScoreAI: null,
        });
      }
      res.status(200).json({ savedArticles: savedArticleArray });
    }
  } catch (e) {
    console.error(e);
    return res.sendStatus(500);
  }
});

app.post("/request-reset", authLimiter, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
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
    session.startTransaction();
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

  if (
    !data.articleId ||
    !data.type ||
    (data.type === "other" && !data.details)
  ) {
    return res.sendStatus(400);
  }

  const feedbackTicket = await Feedback.create({
    articleId: data.articleId,
    articleLink: data.articleLink,
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

  const session = await mongoose.startSession();
  try {
    await session.startTransaction();

    const deletedAcc = await User.deleteOne(
      { email: req.user.email },
      { session }
    );

    if (deletedAcc.deletedCount === 0) {
      await session.abortTransaction();
      return res.sendStatus(403);
    }

    if (req.user.stripeCustomerId) {
      await stripe.customers.del(req.user.stripeCustomerId);
    }
    res.clearCookie("jwt");
    res.clearCookie("jwt_refresh", { path: "/api/refresh" });
    await session.commitTransaction();
    res.sendStatus(200);
  } catch (e) {
    await session.abortTransaction();
    console.error(e);
    res.sendStatus(403);
  } finally {
    await session.endSession();
  }
});

app.post("/api/refresh/update-language", specialAuthToken, async (req, res) => {
  if (req.user.plan === "free") {
    return res.sendStatus(409);
  }
  const currentLang = req.user.selectedContentLanguage
    ? req.user.selectedContentLanguage
    : "en";
  let isAllowed = true;
  if (req.user.selectedContentLanguageSetAt) {
    const originalDate = new Date(req.user.selectedContentLanguageSetAt);
    if (new Date(originalDate.getTime() + 60 * 60 * 1000) > new Date()) {
      isAllowed = false;
    }
  }

  if (!isAllowed) {
    return res.sendStatus(503);
  }
  try {
    if (req.body.language === "en") {
      if (currentLang === "en") {
        return res.sendStatus(400);
      } else if (currentLang === "nl") {
        await User.updateOne(
          { email: req.user.email },
          {
            $set: {
              selectedContentLanguage: "en",
              selectedContentLanguageSetAt: new Date(),
            },
          }
        );
        res.sendStatus(200);
      }
    } else if (req.body.language === "nl") {
      if (currentLang === "nl") {
        return res.sendStatus(400);
      } else if (currentLang === "en") {
        await User.updateOne(
          { email: req.user.email },
          {
            $set: {
              selectedContentLanguage: "nl",
              selectedContentLanguageSetAt: new Date(),
            },
          }
        );
        res.sendStatus(200);
      }
    } else {
      throw new Error();
    }
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// Create checkout session for new subscription (Stripe)
app.post("/api/create-checkout-session", specialAuthToken, async (req, res) => {
  const session = await mongoose.startSession();
  const user = req.user;

  try {
    session.startTransaction();

    const { plan, withTrial } = req.body;

    if (!user.verified) {
      await session.abortTransaction();
      return res.sendStatus(401);
    }

    const priceId = PLAN_TO_PRICE[plan];
    if (!priceId) {
      await session.abortTransaction();
      return res.sendStatus(400);
    }

    // Check if user already has an active subscription in database
    if (
      user.subscription?.status === "active" ||
      user.subscription?.status === "trialing" ||
      user.subscription?.status === "past_due"
    ) {
      await session.abortTransaction();
      return res.status(409).json({ error: "already_subscribed" });
    }

    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user._id.toString(),
        },
      });
      customerId = customer.id;
    } else {
      // User has a Stripe customer ID - check Stripe directly for active subscriptions
      const existingSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
      });

      const hasActiveSubscription = existingSubscriptions.data.some((sub) =>
        ["active", "trialing", "past_due", "incomplete"].includes(sub.status)
      );

      if (hasActiveSubscription) {
        // Sync the subscription status to database
        const activeSub = existingSubscriptions.data.find((sub) =>
          ["active", "trialing", "past_due"].includes(sub.status)
        );
        if (activeSub) {
          // Get current_period_end from the subscription item
          const currentPeriodEnd = activeSub.items.data[0].current_period_end;
          await User.updateOne(
            { email: user.email },
            {
              $set: {
                subscription: {
                  id: activeSub.id,
                  status: activeSub.status,
                  priceId: activeSub.items.data[0].price.id,
                  currentPeriodEnd: currentPeriodEnd
                    ? new Date(currentPeriodEnd * 1000)
                    : null,
                  cancelAtPeriodEnd: activeSub.cancel_at_period_end,
                  trialEnd: activeSub.trial_end
                    ? new Date(activeSub.trial_end * 1000)
                    : null,
                },
                plan: PRICE_TO_PLAN[activeSub.items.data[0].price.id] || "free",
              },
            },
            { session }
          );
        }

        await session.abortTransaction();
        return res.status(409).json({ error: "already_subscribed" });
      }
    }

    const canHaveTrial = withTrial && !user.hasUsedTrial;

    const subscriptionData = {
      metadata: {
        email: user.email,
        plan: "everyday",
      },
    };

    if (canHaveTrial) {
      subscriptionData.trial_period_days = TRIAL_DAYS;
    }

    // Create checkout session
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${URL}/content?payment=success`,
      cancel_url: `${URL}/content?payment=canceled`,
      metadata: {
        email: user.email,
        plan: "everyday",
        isTrialStart: canHaveTrial ? "true" : "false",
      },
      subscription_data: subscriptionData,
      // Expire the checkout session after 30 minutes
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    // Save pending checkout info and customer ID
    await User.updateOne(
      { email: user.email },
      {
        $set: {
          stripeCustomerId: customerId,
        },
      },
      { session }
    );

    await session.commitTransaction();

    res.json({
      url: checkoutSession.url,
      hasTrial: canHaveTrial,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Checkout session error:", err);
    res.sendStatus(500);
  } finally {
    await session.endSession();
  }
});

// Create customer portal session (manage subscription, update payment, cancel)
app.post("/api/create-portal-session", specialAuthToken, async (req, res) => {
  try {
    const user = req.user;

    if (!user.stripeCustomerId) {
      return res.sendStatus(404); // Frontend: no subscription found
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${URL}/content`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Portal session error:", err);
    res.sendStatus(500); // Frontend: Failed to create portal session
  }
});

// Cancel subscription (at period end)
app.post("/api/cancel-subscription", specialAuthToken, async (req, res) => {
  try {
    const user = req.user;

    if (!user.subscription?.id) {
      return res.sendStatus(404); // Frontend: No active subscription found
    }

    if (user.subscription.status === "trialing") {
      await stripe.subscriptions.cancel(user.subscription.id);
      await User.updateOne(
        { email: user.email },
        {
          $set: {
            subscription: {
              id: null,
              status: "canceled",
              priceId: null,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              trialEnd: null,
            },
            hasUsedTrial: true,
            plan: "free",
          },
        }
      );

      return res.sendStatus(202);
    }

    // Cancel at end of current period (user keeps access until then)
    await stripe.subscriptions.update(user.subscription.id, {
      cancel_at_period_end: true,
    });

    await User.updateOne(
      { email: user.email },
      { $set: { "subscription.cancelAtPeriodEnd": true } }
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("Cancel subscription error:", err);
    res.sendStatus(500); // Frontend: failed to cancel, something went wrong
  }
});

// Reactivate canceled subscription (before period ends)
app.post("/api/reactivate-subscription", specialAuthToken, async (req, res) => {
  try {
    const user = req.user;

    if (!user.subscription?.id) {
      return res.sendStatus(404); // Frontend: no subscription found to reactivate
    }

    await stripe.subscriptions.update(user.subscription.id, {
      cancel_at_period_end: false,
    });

    await User.updateOne(
      { email: user.email },
      { $set: { "subscription.cancelAtPeriodEnd": false } }
    );

    res.sendStatus(200); // Frontend: subscription reactivated
  } catch (err) {
    console.error("Reactivate subscription error:", err);
    res.sendStatus(500); // Frontend: failed to reactivate subscription
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
  res.sendFile(path.join(__dirname, "..", "public", "dash.html"));
});

app.get("/pricing", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "pricing.html"));
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

async function handleSubscriptionCreated(subscription) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const customerId = subscription.customer;
    const freshSubscription = await stripe.subscriptions.retrieve(
      subscription.id
    );

    const priceId = freshSubscription.items.data[0].price.id;
    const plan = PRICE_TO_PLAN[priceId] || "free";
    const currentPeriodEnd = freshSubscription.items.data[0].current_period_end;

    const updateData = {
      subscription: {
        id: freshSubscription.id,
        status: freshSubscription.status,
        priceId: priceId,
        currentPeriodEnd: currentPeriodEnd
          ? new Date(currentPeriodEnd * 1000)
          : null,
        cancelAtPeriodEnd: freshSubscription.cancel_at_period_end,
        trialEnd: freshSubscription.trial_end
          ? new Date(freshSubscription.trial_end * 1000)
          : null,
      },
      plan: plan,
    };

    if (freshSubscription.status === "trialing") {
      updateData.hasUsedTrial = true;
    }

    await User.updateOne(
      { stripeCustomerId: customerId },
      { $set: updateData },
      { session }
    );

    await session.commitTransaction();
  } catch (error) {
    console.error(error);
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function handleCheckoutComplete(checkoutSession) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const customerId = checkoutSession.customer;
    const subscriptionId = checkoutSession.subscription;
    const userEmail = checkoutSession.metadata?.email;
    const isTrialStart = checkoutSession.metadata?.isTrialStart === "true";

    if (!userEmail) {
      console.error("No email found in checkout session");
      await session.abortTransaction();
      return;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const currentPeriodEnd = subscription.items.data[0].current_period_end;
    const priceId = subscription.items.data[0].price.id;
    const plan = PRICE_TO_PLAN[priceId] || "free";

    const updateData = {
      stripeCustomerId: customerId,
      subscription: {
        id: subscriptionId,
        status: subscription.status,
        priceId: priceId,
        currentPeriodEnd: currentPeriodEnd
          ? new Date(currentPeriodEnd * 1000)
          : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
      },
      plan: plan,
    };

    if (isTrialStart || subscription.status === "trialing") {
      updateData.hasUsedTrial = true;
    }

    await User.updateOne(
      { email: userEmail },
      { $set: updateData },
      { session }
    );

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function handleSubscriptionUpdate(subscription) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const customerId = subscription.customer;
    const freshSubscription = await stripe.subscriptions.retrieve(
      subscription.id
    );

    const currentPeriodEnd = freshSubscription.items.data[0].current_period_end;
    const priceId = freshSubscription.items.data[0].price.id;
    const plan = PRICE_TO_PLAN[priceId] || "free";

    let effectivePlan = "free";
    if (
      freshSubscription.status === "active" ||
      freshSubscription.status === "trialing"
    ) {
      effectivePlan = plan;
    }

    await User.updateOne(
      { stripeCustomerId: customerId },
      {
        $set: {
          subscription: {
            id: freshSubscription.id,
            status: freshSubscription.status,
            priceId: priceId,
            currentPeriodEnd: currentPeriodEnd
              ? new Date(currentPeriodEnd * 1000)
              : null,
            cancelAtPeriodEnd: freshSubscription.cancel_at_period_end,
            trialEnd: freshSubscription.trial_end
              ? new Date(freshSubscription.trial_end * 1000)
              : null,
          },
          plan: effectivePlan,
        },
      },
      { session }
    );

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function handleSubscriptionCanceled(subscription) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const customerId = subscription.customer;

    await User.updateOne(
      { stripeCustomerId: customerId },
      {
        $set: {
          subscription: {
            id: null,
            status: "canceled",
            priceId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            trialEnd: null,
          },
          plan: "free",
        },
      },
      { session }
    );

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function handleTrialEnding(subscription) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const customerId = subscription.customer;
    const user = await User.findOne({ stripeCustomerId: customerId }).session(
      session
    );

    if (user) {
      await sendTrialEndingEmail(user.email, user.name, subscription.trial_end);
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function handlePaymentSucceeded(invoice) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const customerId = invoice.customer;
    const subscriptionId = invoice.subscription;

    if (!subscriptionId) {
      await session.abortTransaction();
      return;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const currentPeriodEnd = subscription.items.data[0].current_period_end;
    const priceId = subscription.items.data[0].price.id;
    const plan = PRICE_TO_PLAN[priceId] || "free";

    await User.updateOne(
      { stripeCustomerId: customerId },
      {
        $set: {
          subscription: {
            id: subscriptionId,
            status: "active",
            priceId: priceId,
            currentPeriodEnd: currentPeriodEnd
              ? new Date(currentPeriodEnd * 1000)
              : null,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            trialEnd: null,
          },
          plan: plan,
        },
      },
      { session }
    );

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function sendTrialEndingEmail(userEmail, userName, trialEndTimestamp) {
  const trialEndDate = new Date(trialEndTimestamp * 1000).toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  const mailOptions = {
    from: `"Header App" <${process.env.EMAIL_APP}>`,
    to: userEmail,
    subject: "Your Header trial is ending soon",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body style="font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 40px 20px; background-color: #f4f7fa;">
        <table width="600" style="margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color: #0f172a; padding: 40px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Your trial ends on ${trialEndDate}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="color: #0f172a; font-size: 17px;">Hi <strong>${userName}</strong>,</p>
              <p style="color: #64748b; font-size: 15px; line-height: 1.7;">
                We hope you've been enjoying Header! Your free trial is ending soon. 
                After your trial ends, you'll be charged €5/month (or €50/year if you chose annual billing).
              </p>
              <p style="color: #64748b; font-size: 15px; line-height: 1.7;">
                If you'd like to continue using Header's premium features, no action is needed - your subscription will start automatically.
              </p>
              <p style="color: #64748b; font-size: 15px; line-height: 1.7;">
                If you'd prefer not to continue, you can cancel anytime before your trial ends.
              </p>
              <table style="margin: 32px auto;">
                <tr>
                  <td style="background-color: #0f172a; border-radius: 12px;">
                    <a href="${URL}/content" style="display: inline-block; padding: 16px 48px; color: white; text-decoration: none; font-weight: 600;">
                      Manage Subscription
                    </a>
                  </td>
                </tr>
              </table>
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
    console.error("Trial ending email failed:", e);
  }
}

async function handlePaymentFailed(invoice) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const customerId = invoice.customer;

    await User.updateOne(
      { stripeCustomerId: customerId },
      {
        $set: {
          "subscription.status": "past_due",
        },
      },
      { session }
    );

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function startServer() {
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

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
        session.startTransaction();

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
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email | Header</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: 'Segoe UI', Arial, sans-serif;">
  
  <!-- Wrapper -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f7fa; padding: 40px 20px;">
    <tr>
      <td align="center">
        
        <!-- Main Container -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          
          <!-- Header with Dark Theme -->
          <tr>
            <td style="background-color: #0f172a; padding: 40px 40px; text-align: center; position: relative;">
              
              <!-- Logo -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 24px auto;">
                <tr>
                  <td>
                    <span style="font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -1px; font-family: 'Segoe UI', Arial, sans-serif;">Header</span>
                    <span style="font-size: 20px; color: #2563eb; position: relative; top: -8px; margin-left: 2px;"><sup>✦</sup></span>
                  </td>
                </tr>
              </table>
              
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
                Verify your email address
              </h1>
              <p style="color: rgba(255, 255, 255, 0.7); margin: 12px 0 0 0; font-size: 15px;">
                You're one step away from your personalized news feed
              </p>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 48px 40px;">
              
              <!-- Greeting -->
              <p style="color: #0f172a; font-size: 17px; margin: 0 0 20px 0; line-height: 1.6;">
                Hi <strong>${userName}</strong>,
              </p>
              
              <p style="color: #64748b; font-size: 15px; margin: 0 0 32px 0; line-height: 1.7;">
                Thanks for signing up for Header! To start receiving your personalized AI news summaries, please verify your email address by clicking the button below.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 32px auto;">
                <tr>
                  <td align="center" style="background-color: #0f172a; border-radius: 12px;">
                    <a href="${verificationLink}" target="_blank" style="display: inline-block; padding: 16px 48px; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none;">
                      Verify my email →
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- What you'll get -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-radius: 12px; margin-bottom: 32px;">
                <tr>
                  <td style="padding: 24px;">
                    <p style="color: #0f172a; font-size: 14px; font-weight: 600; margin: 0 0 16px 0;">
                      Some notes to keep your account safe:
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding: 6px 0;">
                          <span style="color: #2563eb; margin-right: 10px;">⏰</span>
                          <span style="color: #64748b; font-size: 14px;">This link expires in 24 hours.</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Alternative Link -->
              <p style="color: #94a3b8; font-size: 13px; margin: 0 0 10px 0;">
                Button not working? Copy and paste this link:
              </p>
              <p style="background-color: #f1f5f9; padding: 12px 14px; border-radius: 8px; word-break: break-all; margin: 0 0 32px 0;">
                <a href="${verificationLink}" style="color: #2563eb; font-size: 12px; text-decoration: none;">
                  ${verificationLink}
                </a>
              </p>
              
              <!-- Divider -->
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">
              
              <!-- Security Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 0;">
                    <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.6;">
                      <strong style="color: #64748b;">Didn't sign up for Header?</strong><br>
                      No worries — just ignore this email and your address won't be used.
                    </p>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #0f172a; padding: 32px 40px; text-align: center;">
              
              <!-- Logo in footer -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 16px auto;">
                <tr>
                  <td>
                    <span style="font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; font-family: 'Segoe UI', Arial, sans-serif;">Header</span>
                    <span style="font-size: 14px; color: #2563eb; position: relative; top: -4px; margin-left: 1px;"><sup>✦</sup></span>
                  </td>
                </tr>
              </table>
              
              <p style="color: rgba(255, 255, 255, 0.5); font-size: 13px; margin: 0 0 8px 0; line-height: 1.6;">
                AI-powered news summaries for busy professionals and casuals
              </p>
              
              <p style="color: rgba(255, 255, 255, 0.3); font-size: 11px; margin: 16px 0 0 0;">
                © 2025 Header News. All rights reserved.
              </p>
              
            </td>
          </tr>
          
        </table>
        
        <!-- Bottom note -->
        <p style="color: #94a3b8; font-size: 11px; margin: 20px 0 0 0; text-align: center;">
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
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Change Request | Header</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: 'Segoe UI', Arial, sans-serif;">
  
  <!-- Wrapper -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f7fa; padding: 40px 20px;">
    <tr>
      <td align="center">
        
        <!-- Main Container -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          
          <tr>
            <td style="background-color: #0f172a; padding: 40px 40px; text-align: center; position: relative;">
              
              <!-- Logo -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 24px auto;">
                <tr>
                  <td>
                    <span style="font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -1px; font-family: 'Segoe UI', Arial, sans-serif;">Header</span>
                    <span style="font-size: 20px; color: #2563eb; position: relative; top: -8px; margin-left: 2px;"><sup>✦</sup></span>
                  </td>
                </tr>
              </table>
              
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
                Change your password here.
              </h1>
              <p style="color: rgba(255, 255, 255, 0.7); margin: 12px 0 0 0; font-size: 15px;">
                Lost or forgot your password? Let's change it!
              </p>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 48px 40px;">
              
              <!-- Greeting -->
              <p style="color: #0f172a; font-size: 17px; margin: 0 0 20px 0; line-height: 1.6;">
                Hi <strong>${userName}</strong>,
              </p>
              
              <p style="color: #64748b; font-size: 15px; margin: 0 0 32px 0; line-height: 1.7;">
                We have received your request to change your password. Please click the button below to confirm this action and enter your new password.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 32px auto;">
                <tr>
                  <td align="center" style="background-color: #0f172a; border-radius: 12px;">
                    <a href="${resetLink}" target="_blank" style="display: inline-block; padding: 16px 48px; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none;">
                      Change password →
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Alternative Link -->
              <p style="color: #94a3b8; font-size: 13px; margin: 0 0 10px 0;">
                Button not working? Copy and paste this link:
              </p>
              <p style="background-color: #f1f5f9; padding: 12px 14px; border-radius: 8px; word-break: break-all; margin: 0 0 32px 0;">
                <a href="${resetLink}" style="color: #2563eb; font-size: 12px; text-decoration: none;">
                  ${resetLink}
                </a>
              </p>
              
              <!-- Divider -->
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">
              
              <!-- Security Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 0;">
                    <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.6;">
                      <strong style="color: #64748b;">This email expires in 1 hour.</strong><br>
                      Please retry if expires.
                    </p>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #0f172a; padding: 32px 40px; text-align: center;">
              
              <!-- Logo in footer -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 16px auto;">
                <tr>
                  <td>
                    <span style="font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; font-family: 'Segoe UI', Arial, sans-serif;">Header</span>
                    <span style="font-size: 14px; color: #2563eb; position: relative; top: -4px; margin-left: 1px;"><sup>✦</sup></span>
                  </td>
                </tr>
              </table>
              
              <p style="color: rgba(255, 255, 255, 0.5); font-size: 13px; margin: 0 0 8px 0; line-height: 1.6;">
                AI-powered news summaries for busy professionals and casuals
              </p>
              
              <p style="color: rgba(255, 255, 255, 0.3); font-size: 11px; margin: 16px 0 0 0;">
                © 2025 Header News. All rights reserved.
              </p>
              
            </td>
          </tr>
          
        </table>
        
        <!-- Bottom note -->
        <p style="color: #94a3b8; font-size: 11px; margin: 20px 0 0 0; text-align: center;">
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
