import nodemailer from 'nodemailer';

// Email configuration from environment variables
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.mailgun.org';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@sgchat.local';

// Check if email is configured
export function isEmailConfigured(): boolean {
  return !!(SMTP_USER && SMTP_PASS);
}

// Create reusable transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    if (!isEmailConfigured()) {
      throw new Error('Email not configured: SMTP_USER and SMTP_PASS are required');
    }

    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true for 465, false for other ports
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send a password reset email
 */
export async function sendPasswordResetEmail(
  to: string,
  resetLink: string,
  username: string
): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn('⚠️ Email not configured. Password reset link:', resetLink);
    return;
  }

  const transport = getTransporter();

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #1e1f22; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #1e1f22;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #2b2d31; border-radius: 8px;">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 24px; color: #ffffff; font-size: 24px; font-weight: 600; text-align: center;">
                Reset Your Password
              </h1>
              <p style="margin: 0 0 16px; color: #b5bac1; font-size: 16px; line-height: 24px;">
                Hey ${username},
              </p>
              <p style="margin: 0 0 24px; color: #b5bac1; font-size: 16px; line-height: 24px;">
                We received a request to reset your password. Click the button below to choose a new password:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 16px 0;">
                    <a href="${resetLink}" 
                       style="display: inline-block; padding: 12px 24px; background-color: #5865f2; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 500; border-radius: 4px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; color: #b5bac1; font-size: 14px; line-height: 20px;">
                This link will expire in <strong style="color: #ffffff;">15 minutes</strong>.
              </p>
              <p style="margin: 16px 0 0; color: #b5bac1; font-size: 14px; line-height: 20px;">
                If you didn't request this, you can safely ignore this email. Your password will remain unchanged.
              </p>
              <hr style="margin: 32px 0; border: none; border-top: 1px solid #3f4147;">
              <p style="margin: 0; color: #6d6f78; font-size: 12px; line-height: 18px; text-align: center;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0; color: #5865f2; font-size: 12px; line-height: 18px; text-align: center; word-break: break-all;">
                ${resetLink}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const textContent = `
Reset Your Password

Hey ${username},

We received a request to reset your password. Click the link below to choose a new password:

${resetLink}

This link will expire in 15 minutes.

If you didn't request this, you can safely ignore this email. Your password will remain unchanged.
`;

  await transport.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Reset Your Password',
    text: textContent.trim(),
    html: htmlContent,
  });

  console.log(`📧 Password reset email sent to ${to}`);
}
