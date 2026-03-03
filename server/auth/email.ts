// Email sending utility
// Supports multiple providers: SendGrid, Resend, or Nodemailer (SMTP)

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'console';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@predictiveapex.club';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function sendWithSendGrid(options: EmailOptions ): Promise<void> {
  const sgMail = await import('@sendgrid/mail');
  sgMail.default.setApiKey(process.env.SENDGRID_API_KEY!);
  
  await sgMail.default.send({
    to: options.to,
    from: FROM_EMAIL,
    subject: options.subject,
    html: options.html,
  });
}

async function sendWithResend(options: EmailOptions): Promise<void> {
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  
  await resend.emails.send({
    from: FROM_EMAIL,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
}

async function sendWithSMTP(options: EmailOptions): Promise<void> {
  const nodemailer = await import('nodemailer');
  
  const transporter = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  
  await transporter.sendMail({
    from: FROM_EMAIL,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
}

async function sendToConsole(options: EmailOptions): Promise<void> {
  console.log('\n========== EMAIL ==========');
  console.log('To:', options.to);
  console.log('Subject:', options.subject);
  console.log('HTML:', options.html);
  console.log('===========================\n');
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  try {
    switch (EMAIL_PROVIDER) {
      case 'sendgrid':
        await sendWithSendGrid(options);
        break;
      case 'resend':
        await sendWithResend(options);
        break;
      case 'smtp':
        await sendWithSMTP(options);
        break;
      case 'console':
      default:
        await sendToConsole(options);
        break;
    }
    console.log(`[Email] Sent email to ${options.to}`);
  } catch (error) {
    console.error('[Email] Failed to send email:', error);
    throw error;
  }
}

export async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  const magicLink = `${APP_URL}/auth/verify?token=${token}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sign in to Predictive Apex</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 40px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border-radius: 8px; overflow: hidden;">
        <tr>
          <td style="padding: 40px 40px 20px;">
            <h1 style="color: #ffffff; font-size: 24px; margin: 0 0 20px;">Welcome to Predictive Apex</h1>
            <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
              Click the button below to sign in to your account. This link will expire in 15 minutes.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin: 0 0 30px;">
              <tr>
                <td style="background-color: #3b82f6; border-radius: 6px; text-align: center;">
                  <a href="${magicLink}" style="display: inline-block; padding: 14px 40px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                    Sign In
                  </a>
                </td>
              </tr>
            </table>
            <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0;">
              If you didn't request this email, you can safely ignore it.
            </p>
            <p style="color: #64748b; font-size: 12px; line-height: 1.6; margin: 20px 0 0;">
              Or copy and paste this link into your browser:  

              <a href="${magicLink}" style="color: #3b82f6; word-break: break-all;">${magicLink}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 40px; background-color: #0f172a; text-align: center;">
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              © 2025 Predictive Apex. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
  
  await sendEmail({
    to: email,
    subject: 'Sign in to Predictive Apex',
    html,
  });
}
