import type { SendEmailParams } from './types.js';

/**
 * Validates that header values do NOT contain CR or LF characters (preventing header injection).
 */
export function assertSafeHeader(name: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(
      `Header injection detected: header '${name}' contains carriage return or line feed characters.`,
    );
  }
  return value.trim();
}

/**
 * Sanitizes an attachment filename to only allow alphanumeric characters, underscores, and hyphens.
 */
export function sanitizeFilename(filename: string): string {
  const parts = filename.split('.');
  const ext = parts.length > 1 ? parts.pop() : 'pdf';
  const base = parts.join('.');
  const cleanBase = base.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${cleanBase || 'resume'}.${ext || 'pdf'}`;
}

/**
 * Converts a Uint8Array to base64 string chunked at 76 characters per line (RFC 2045).
 */
export function toChunkedBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      binary += String.fromCharCode(byte);
    }
  }
  const base64 = btoa(binary);
  // Split into 76-character lines
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 76) {
    lines.push(base64.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

/**
 * Encodes a string to RFC 4648 Base64URL without padding (expected by Gmail REST API).
 */
export function toBase64Url(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      binary += String.fromCharCode(byte);
    }
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Builds an RFC 2822 multipart/mixed MIME message string.
 */
export function buildMimeMessage(params: SendEmailParams): string {
  const {
    fromEmail,
    fromName,
    recipientEmail,
    subject,
    bodyText,
    messageIdHeader,
    resumePdfBytes,
    resumeFileName = 'Resume.pdf',
  } = params;

  // Validate headers against injection
  const safeFromEmail = assertSafeHeader('From', fromEmail);
  const safeFromName = fromName ? assertSafeHeader('From Name', fromName) : undefined;
  const safeTo = assertSafeHeader('To', recipientEmail);
  const safeSubject = assertSafeHeader('Subject', subject);
  const safeMessageId = assertSafeHeader('Message-ID', messageIdHeader);

  const fromHeader = safeFromName ? `"${safeFromName}" <${safeFromEmail}>` : safeFromEmail;
  const boundary = `===============PIGEON_BOUNDARY_${crypto.randomUUID().replace(/-/g, '')}==`;

  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    `Message-ID: ${safeMessageId.startsWith('<') ? safeMessageId : `<${safeMessageId}>`}`,
    'MIME-Version: 1.0',
    `Date: ${new Date().toUTCString()}`,
  ];

  if (params.inReplyTo) {
    const safeInReplyTo = assertSafeHeader('In-Reply-To', params.inReplyTo);
    headers.push(`In-Reply-To: ${safeInReplyTo.startsWith('<') ? safeInReplyTo : `<${safeInReplyTo}>`}`);
  }

  if (params.references) {
    const safeReferences = assertSafeHeader('References', params.references);
    headers.push(`References: ${safeReferences.startsWith('<') ? safeReferences : `<${safeReferences}>`}`);
  }

  if (!resumePdfBytes || resumePdfBytes.length === 0) {
    // Single plain text message
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push('Content-Transfer-Encoding: 7bit');
    return headers.join('\r\n') + '\r\n\r\n' + bodyText;
  }

  // Multipart/mixed message with PDF attachment
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const cleanFilename = sanitizeFilename(resumeFileName);
  const chunkedPdf = toChunkedBase64(resumePdfBytes);

  const parts: string[] = [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    bodyText,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${cleanFilename}"`,
    `Content-Disposition: attachment; filename="${cleanFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    chunkedPdf,
    '',
    `--${boundary}--`,
  ];

  return parts.join('\r\n');
}
