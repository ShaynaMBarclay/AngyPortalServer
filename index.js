const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
require("dotenv").config();

const admin = require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const PORT = process.env.PORT || 3001;

// ===== Firestore Setup =====
const db = admin.firestore();

// ===== Middleware =====
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://angyportal.netlify.app",
    "https://angyportal.love"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(bodyParser.json());
app.options("*", cors()); // For preflight requests

// ===== In-Memory Stores =====
const verifiedTokens = new Set();
const verifiedEmails = new Set(); // This was missing but is used later!

// ===== Firestore Helpers =====
async function isEmailVerified(email) {
  const doc = await db.collection("verifiedPartners").doc(email).get();
  return doc.exists;
}

async function markEmailAsVerified(email) {
  await db.collection("verifiedPartners").doc(email).set({ verified: true });
  verifiedEmails.add(email); // Add to in-memory cache
}

// ===== Middleware: Verify Firebase ID Token =====
async function authenticateFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized, no token provided" });
  }

  const idToken = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Firebase token verification failed:", error);
    return res.status(401).json({ error: "Unauthorized, invalid token" });
  }
}

// ===== Route: Send Verification Email =====
app.post("/api/send-verification", async (req, res) => {
  const { partnerEmail } = req.body;

  const token = Math.random().toString(36).substring(2, 10);
  verifiedTokens.add(token);

  const verificationLink = `https://angyportal.love/verify?token=${token}&email=${encodeURIComponent(partnerEmail)}`;

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"Grievance Portal" <${process.env.EMAIL}>`,
      to: partnerEmail,
      subject: "Please verify to receive grievances",
      html: `<p>Your partner wants to share grievances with you. Click <a href="${verificationLink}">here</a> to accept.</p>`,
    });

    res.status(200).json({ message: "Verification email sent." });
  } catch (err) {
    console.error("Email send error:", err);
    res.status(500).json({ error: "Failed to send verification email." });
  }
});

// ===== Route: Verify Token and Save Email =====
app.get("/api/verify", async (req, res) => {
  const token = req.query.token;
  const email = req.query.email;

  if (verifiedTokens.has(token)) {
    verifiedTokens.delete(token);
    await markEmailAsVerified(email);
    return res.status(200).json({ success: true, message: "Partner verified." });
  }

  res.status(400).json({ success: false, message: "Invalid or expired token." });
});

// ===== Route: Check if Partner Email is Verified =====
app.get("/api/is-verified", authenticateFirebaseToken, async (req, res) => {
  const email = req.query.email;
  const verified = await isEmailVerified(email);
  res.json({ verified });
});

// ===== Route: Submit Grievance =====
app.post("/api/send-grievance", authenticateFirebaseToken, async (req, res) => {
  const { partnerEmail, grievance, senderName, angyLevel } = req.body;

   console.log("Received grievance payload:", { partnerEmail, grievance, senderName, angyLevel });
   
  const isVerified = await isEmailVerified(partnerEmail);
  if (!isVerified) {
    return res.status(403).json({ error: "Partner email not verified." });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"Grievance Portal" <${process.env.EMAIL}>`,
      to: partnerEmail,
      subject: "New Grievance Submitted",
      text:  `From: ${senderName || "Anonymous"}\n` +
    `Angy Level: ${angyLevel ?? "Not provided"}\n\n` +
    `${grievance}`,
    });

    res.status(200).json({ message: "Grievance sent via email." });
  } catch (err) {
    console.error("Error sending grievance email:", err);
    res.status(500).json({ error: "Failed to send grievance email." });
  }
});

// ===== Route: Protected Test =====
app.get("/api/protected", authenticateFirebaseToken, (req, res) => {
  res.json({ message: "You are authorized", user: req.user });
});

// ===== Route: Health Check =====
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
