import { Resend } from "resend";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const RESEND_FROM =
  (process.env.RESEND_FROM || "Safesight <noreply@safesight.app>").trim();
const PUBLIC_ORIGIN = (
  process.env.SAFESIGHT_PUBLIC_ORIGIN ||
  process.env.PUBLIC_APP_URL ||
  "https://safesight.noahwhiteson.com"
).replace(/\/$/, "");

const OTP_EXPIRES_MINUTES = 5;

let resendClient = null;

export function isResendConfigured() {
  return Boolean(RESEND_API_KEY);
}

function getResend() {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

export function otpExpiresMinutes() {
  return OTP_EXPIRES_MINUTES;
}

export async function sendLoginCodeEmail({ to, code }) {
  const resend = getResend();
  const logoUrl = `${PUBLIC_ORIGIN}/logo.png`;
  const digits = String(code).split("");

  const digitCells = digits
    .map(
      (d) =>
        `<td style="width:44px;height:52px;background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;text-align:center;font-size:26px;font-weight:600;color:#18181b;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${d}</td>`
    )
    .join('<td style="width:8px;"></td>');

  const { data, error } = await resend.emails.send({
    from: RESEND_FROM,
    to: [to],
    subject: `${code} · Safesight sign-in code`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Safesight sign-in</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:440px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <tr>
            <td style="padding:32px 32px 24px;text-align:center;background:linear-gradient(180deg,#ffffff 0%,#fafafa 100%);">
              <img src="${logoUrl}" width="56" height="56" alt="Safesight" style="display:block;margin:0 auto 16px;border-radius:14px;" />
              <div style="font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#71717a;">Sign in to Safesight</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 8px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;line-height:1.3;">Your verification code</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#52525b;">Enter this code in the app to continue. It expires in <strong>${OTP_EXPIRES_MINUTES} minutes</strong>.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px;">
                <tr>${digitCells}</tr>
              </table>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#a1a1aa;">If you didn&rsquo;t request this, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#fafafa;border-top:1px solid #f4f4f5;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;text-align:center;">Safesight &middot; Visible-risk assistant for your home</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Your Safesight sign-in code is ${code}. It expires in ${OTP_EXPIRES_MINUTES} minutes.`,
  });

  if (error) {
    const err = new Error(error.message || "Resend send failed");
    err.detail = error;
    throw err;
  }
  return data;
}
