const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL, 
    pass: process.env.EMAIL_PASSWORD, 
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP Auth failed:", error);
  } else {
    console.log("SMTP Auth successful! Server is ready to send emails.");
  }
});
