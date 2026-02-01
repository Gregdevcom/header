import { z } from "zod";
import mongoose from "mongoose";
import { validate as uuidValidate } from "uuid";

export const signUpSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required")
    .max(254, "Email is too long")
    .email("Invalid email format"),

  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(20, "Name must be less than 20 characters")
    .regex(
      /^[a-zA-ZÀ-ÿ'-]+$/,
      "Name must be one word (letters, hyphens, apostrophes only)"
    ),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(
      /[^A-Za-z0-9]/,
      "Password must contain at least one special character"
    )
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter"),
});

export const passwordSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(
      /[^A-Za-z0-9]/,
      "Password must contain at least one special character"
    )
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter"),
  token: z.string().min(1),
});

export const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(20, "Name must be less than 20 characters")
    .regex(
      /^[a-zA-ZÀ-ÿ'-]+$/,
      "Name must be one word (letters, hyphens, apostrophes only)"
    ),
});

export const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required")
    .max(254, "Email is too long")
    .email("Invalid email format"),
});

export const validateSignUp = (req, res, next) => {
  const result = signUpSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      field: e.path[0],
      message: e.message,
    }));

    return res.status(400).json(errors);
  }

  req.body = result.data;
  next();
};

export const validatePass = (req, res, next) => {
  const result = passwordSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      field: e.path[0],
      message: e.message,
    }));

    return res.status(400).json(errors);
  }

  req.body = result.data;
  next();
};

export const validateName = (req, res, next) => {
  const result = nameSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      field: e.path[0],
      message: e.message,
    }));

    return res.status(400).json(errors);
  }

  req.body = result.data;
  next();
};

export const validateEmail = (req, res, next) => {
  const result = emailSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      field: e.path[0],
      message: e.message,
    }));

    return res.status(422).json(errors);
  }

  req.body = result.data;
  next();
};
