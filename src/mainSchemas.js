import mongoose from "mongoose";

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
    refreshTokens: { type: [{ token: String, expiresAt: Date }], default: [] },
    verified: { type: Boolean, default: false },
    veriToken: { type: String, default: null },
    veriTokenExpiresAt: { type: Date, default: null },
    passChangeToken: { token: String, expiresAt: Date },
    welcome: { type: Boolean, default: true },
    deletionRequestedAt: { type: Date, default: null },
    deleteAt: { type: Date, default: null },
    isDeactivated: { type: Boolean, default: false },
    device_id: { type: String, default: null }, // Make multi device later
    pair_token: { type: String, default: null },
    paired_at: { type: Date, default: null },
    pendingDeviceId: { type: String },
    pendingPairToken: { type: String },
    pendingPairAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ deleteAt: 1, isDeactivated: 1 });

const appFeedbackSchema = new mongoose.Schema({
  type: String, // Feedback/issue type
  details: { type: String, default: null }, // User comment
  email: String, // The email of submitter
});

export const Feedback = mongoose.model("Feedback", appFeedbackSchema);
export const User = mongoose.model("User", userSchema);
