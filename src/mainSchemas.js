import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const articleSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => uuidv4() },
    title: String,
    publisher: String,
    content: String,
    contentNL: String,
    excerpt: String,
    wordCount: Number,
    language: String,
    link: String,
    imageLink: String,
    biasScoreAI: String,
    qualityScoreAI: String,
    longSummaryAI: String,
    bulletSummaryAI: [String],
    tag: String,
    date: String,
    author: String,
    isContentCut: { type: Boolean, default: false },
  },
  { _id: false, timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, default: null },
    authProvider: { type: String, default: "header" },
    stripeCustomerId: {
      type: String,
      default: null,
    },
    subscription: {
      id: { type: String, default: null }, // Stripe subscription ID
      status: { type: String, default: null }, // 'active', 'canceled', 'past_due', etc.
      priceId: { type: String, default: null }, // Which plan
      currentPeriodEnd: { type: Date, default: null }, // When current period ends
      cancelAtPeriodEnd: { type: Boolean, default: false }, // If scheduled to cancel
      trialEnd: { type: Date, default: null },
    },
    hasUsedTrial: { type: Boolean, default: false },
    plan: {
      type: String,
      enum: ["free", "everyday"],
      default: "free",
    },
    refreshTokens: { type: [{ token: String, expiresAt: Date }], default: [] },
    verified: { type: Boolean, default: false },
    veriToken: { type: String, default: null },
    veriTokenExpiresAt: { type: Date, default: null },
    savedArticles: { type: [articleSchema], default: [] },
    passChangeToken: { token: String, expiresAt: Date },
    selectedContentLanguage: {
      type: String,
      default: "en",
    },
    selectedContentLanguageSetAt: {
      type: Date,
      default: null,
    },
    welcome: { type: Boolean, default: true },
    deletionRequestedAt: { type: Date, default: null },
    deleteAt: { type: Date, default: null },
    isDeactivated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.index({ deleteAt: 1, isDeactivated: 1 });

const articleFeedbackSchema = new mongoose.Schema({
  articleId: String,
  articleLink: String,
  type: String, // Feedback/issue type
  details: { type: String, default: null }, // User comment
  email: String, // The email of submitter
});

export const Feedback = mongoose.model("Feedback", articleFeedbackSchema);
export const User = mongoose.model("User", userSchema);
export const ArchiveEN = mongoose.model("ArchiveEN", articleSchema);
export const ArchiveNL = mongoose.model("ArchiveNL", articleSchema);
export const ArticleEN = mongoose.model("ArticleEN", articleSchema);
export const ArticleNL = mongoose.model("ArticleNL", articleSchema);
