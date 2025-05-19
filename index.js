const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
require("dotenv").config();

console.log("EMAIL env var:", process.env.EMAIL);
console.log("EMAIL_PASSWORD env var is set?", !!process.env.EMAIL_PASSWORD);
console.log(`EMAIL_PASSWORD env var: "${process.env.EMAIL_PASSWORD}"`);

const admin = require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const PORT = process.env.PORT || 3001;

const corsOptions = {
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Apply CORS middleware to all routes
app.use(cors(corsOptions));

// Handle preflight OPTIONS requests for all routes
app.options("*", cors(corsOptions));

app.use(bodyParser.json());

// ===== In-Memory Stores =====
const verifiedTokens = new Set();
const verifiedEmails = new Set();

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

// ===== Send Partner Verification Email =====
app.post("/api/send-verification", async (req, res) => {
  const { partnerEmail } = req.body;

  console.log("Sending verification to partnerEmail:", partnerEmail);

  console.log("EMAIL env var:", process.env.EMAIL);
  console.log("EMAIL_PASSWORD env var is set?", !!process.env.EMAIL_PASSWORD);

  const token = Math.random().toString(36).substring(2, 10);
  verifiedTokens.add(token);

  const verificationLink = `http://localhost:5173/verify?token=${token}&email=${encodeURIComponent(partnerEmail)}`;
  console.log("Verification link:", verificationLink);

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
        method: "LOGIN",
      },
      logger: true,
      debug: true,
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

// ===== Verify Token and Save Verified Email =====
app.get("/api/verify", (req, res) => {
  const token = req.query.token;
  const email = req.query.email;
  console.log("Verify request received:", { token, email });

  if (verifiedTokens.has(token)) {
    verifiedTokens.delete(token);
    verifiedEmails.add(email);
    return res.status(200).json({ success: true, message: "Partner verified." });
  }

  res.status(400).json({ success: false, message: "Invalid or expired token." });
});

// ===== Check if Partner Email is Verified (Protected) =====
app.get("/api/is-verified", authenticateFirebaseToken, (req, res) => {
  const email = req.query.email;
  res.json({ verified: verifiedEmails.has(email) });
});

// ===== Submit Grievance (Protected) =====
app.post("/api/send-grievance", authenticateFirebaseToken, async (req, res) => {
  const { partnerEmail, grievance } = req.body;

  if (!verifiedEmails.has(partnerEmail)) {
    return res.status(403).json({ error: "Partner email not verified." });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    console.log("Sending grievance email to:", partnerEmail);

    await transporter.sendMail({
      from: `"Grievance Portal" <${process.env.EMAIL}>`,
      to: partnerEmail,
      subject: "New Grievance Submitted",
      text: grievance,
    });

    console.log(`Grievance email sent to ${partnerEmail}: ${grievance}`);
    res.status(200).json({ message: "Grievance sent via email." });
  } catch (err) {
    console.error("Error sending grievance email:", err);
    res.status(500).json({ error: "Failed to send grievance email." });
  }
});

// ===== Protected Example Route =====
app.get("/api/protected", authenticateFirebaseToken, (req, res) => {
  res.json({ message: "You are authorized", user: req.user });
});

// ===== Health Check Route for Render =====
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
