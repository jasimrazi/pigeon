#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import PostalMime from 'postal-mime';

function printUsage() {
  console.log(`
Pigeon EML Parser Tool (Offline)
Usage:
  pnpm parse-eml <file.eml>

Example:
  pnpm parse-eml packages/shared/fixtures/alerts/linkedin-digest.eml
`);
}

const filePath = process.argv[2];
if (!filePath) {
  printUsage();
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), filePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: File not found: ${resolvedPath}`);
  process.exit(1);
}

const rawEml = fs.readFileSync(resolvedPath, 'utf8');

// Strip HTML tags and entities
function stripHtml(input) {
  if (!input) return '';
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

// Clean tracking parameters per portal allowlist
function cleanTrackingUrl(rawUrl, portal) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim().replace(/&amp;/g, '&').replace(/&#38;/g, '&');
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const effectivePortal =
      portal ||
      (host.includes('indeed.')
        ? 'indeed'
        : host.includes('linkedin.')
          ? 'linkedin'
          : host.includes('naukri.')
            ? 'naukri'
            : 'unknown');

    if (effectivePortal === 'unknown') {
      const toDelete = [];
      url.searchParams.forEach((_, key) => {
        if (/^utm_/i.test(key)) toDelete.push(key);
      });
      toDelete.forEach((k) => url.searchParams.delete(k));
    } else {
      const allowed =
        {
          indeed: new Set(['jk']),
          linkedin: new Set(['currentjobid']),
          naukri: new Set([]),
        }[effectivePortal] || new Set();

      const toDelete = [];
      url.searchParams.forEach((_, key) => {
        if (!allowed.has(key.toLowerCase())) toDelete.push(key);
      });
      toDelete.forEach((k) => url.searchParams.delete(k));
    }

    if (url.hash && /#(utm_|xtor)/i.test(url.hash)) {
      url.hash = '';
    }

    let cleaned = url.toString();
    if (cleaned.endsWith('?')) cleaned = cleaned.slice(0, -1);
    return cleaned;
  } catch {
    return trimmed;
  }
}

function detectPortal(fromAddress) {
  const addr = (fromAddress || '').toLowerCase();
  if (addr.includes('linkedin.com')) return 'linkedin';
  if (addr.includes('naukri.com')) return 'naukri';
  if (addr.includes('indeed.com')) return 'indeed';
  return 'fallback';
}

function parseLinkedIn(html) {
  const jobs = [];
  const linkRegex =
    /<a\b[^>]*href="([^"]*(?:linkedin\.com\/(?:comm\/)?jobs\/view\/|\/jobs\/view\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seen = new Set();

  while ((match = linkRegex.exec(html)) !== null) {
    const cleanTitle = stripHtml(match[2]);
    if (
      !cleanTitle ||
      /^(view|see|apply|read|click|more|follow|check|unsubscribe|settings)/i.test(cleanTitle)
    ) {
      continue;
    }
    const applyUrl = cleanTrackingUrl(match[1], 'linkedin');
    if (seen.has(applyUrl)) continue;
    seen.add(applyUrl);

    const afterLink = html.slice(match.index + match[0].length, match.index + 800);
    const boundary = afterLink.search(
      /<table class="job-card"|<table|<tr|<a\b[^>]*href="[^"]*linkedin\.com/i,
    );
    const context = boundary !== -1 ? afterLink.slice(0, boundary) : afterLink;

    let company = 'Unknown';
    const compMatch =
      context.match(
        /(?:class="[^"]*(?:company|jobsearch-Company|org)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*sub-title[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p)>/i,
      ) || context.match(/<\/a>[\s\S]*?<(?:span|div|p|td)[^>]*>([\s\S]*?)<\/(?:span|div|p|td)>/i);
    if (compMatch?.[1]) {
      const c = stripHtml(compMatch[1]);
      if (c && c !== cleanTitle && c.length < 100) company = c;
    }

    let location = null;
    const locMatch =
      context.match(
        /(?:class="[^"]*(?:location|city|job-location)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
      ) ||
      context.match(
        /(?:[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}(?:\s+\(Hybrid\)|\s+\(Remote\))?|\bRemote\b|\bHybrid\b)/,
      );
    if (locMatch) {
      const l = stripHtml(locMatch[1] || locMatch[0]);
      if (l && l !== cleanTitle && l !== company) location = l;
    }

    let salaryRaw = null;
    const salMatch = context.match(
      /([$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*k)?(?:\s*[-–to/]\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?(?:\s*k)?)?\s*(?:\/\s*(?:yr|year|mo|month|hr|hour)|\bper\s+(?:year|annum|month|hour)\b|\bannually\b|\ba\s+year\b))/i,
    );
    if (salMatch?.[1]) salaryRaw = stripHtml(salMatch[1]);

    jobs.push({ title: cleanTitle, company, location, salary_raw: salaryRaw, apply_url: applyUrl });
  }
  return jobs;
}

function parseNaukri(html) {
  const jobs = [];
  const linkRegex =
    /<a\b[^>]*href="([^"]*(?:naukri\.com\/(?:job-listings|job-alert)[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seen = new Set();

  while ((match = linkRegex.exec(html)) !== null) {
    const cleanTitle = stripHtml(match[2]);
    if (
      !cleanTitle ||
      /^(view|see|apply|read|click|more|unsubscribe|naukri|login)/i.test(cleanTitle)
    )
      continue;
    const applyUrl = cleanTrackingUrl(match[1], 'naukri');
    if (seen.has(applyUrl)) continue;
    seen.add(applyUrl);

    const afterLink = html.slice(match.index + match[0].length, match.index + 800);
    const boundary = afterLink.search(
      /<div class="job-tuple"|<table|<tr|<a\b[^>]*href="[^"]*naukri\.com/i,
    );
    const context = boundary !== -1 ? afterLink.slice(0, boundary) : afterLink;

    let company = 'Unknown';
    const compMatch = context.match(
      /(?:class="[^"]*(?:company|org|comp-name|company-name)[^"]*"[^>]*>|<span[^>]*class="[^"]*c-name[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p|a)>/i,
    );
    if (compMatch?.[1]) {
      const c = stripHtml(compMatch[1]);
      if (c && c !== cleanTitle && c.length < 100) company = c;
    }

    let location = null;
    const locMatch =
      context.match(
        /(?:class="[^"]*(?:location|loc|city)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
      ) ||
      context.match(
        /(?:Bengaluru|Bangalore|Mumbai|Delhi|Hyderabad|Pune|Chennai|Gurgaon|Gurugram|Noida|Kolkata|Ahmedabad|Remote)/i,
      );
    if (locMatch) {
      const l = stripHtml(locMatch[1] || locMatch[0]);
      if (l && l !== cleanTitle && l !== company) location = l;
    }

    let salaryRaw = null;
    const salMatch = context.match(
      /((?:₹\s*[\d,]+(?:\s*-\s*₹?\s*[\d,]+)?|\b\d+(?:\.\d+)?\s*[-–to]\s*\d+(?:\.\d+)?\s*(?:Lacs?|Lakhs?|Cr)\s*(?:PA|P\.A\.|per\s+annum)?|\b(?:Not\s+Disclosed|Best\s+in\s+Industry)\b))/i,
    );
    if (salMatch?.[1] && !/Not Disclosed|Best in Industry/i.test(salMatch[1])) {
      salaryRaw = stripHtml(salMatch[1]);
    }

    jobs.push({ title: cleanTitle, company, location, salary_raw: salaryRaw, apply_url: applyUrl });
  }
  return jobs;
}

function parseIndeed(html) {
  const jobs = [];
  const linkRegex =
    /<a\b[^>]*href="([^"]*(?:indeed\.com\/(?:viewjob|rc\/clk|job\/)[^"]*|\/viewjob[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seen = new Set();

  while ((match = linkRegex.exec(html)) !== null) {
    const cleanTitle = stripHtml(match[2]);
    if (
      !cleanTitle ||
      /^(view|see|apply|read|click|more|unsubscribe|indeed|manage|privacy)/i.test(cleanTitle)
    )
      continue;
    const applyUrl = cleanTrackingUrl(match[1], 'indeed');
    if (seen.has(applyUrl)) continue;
    seen.add(applyUrl);

    const afterLink = html.slice(match.index + match[0].length, match.index + 800);
    const boundary = afterLink.search(
      /<div class="job-result"|<div class="job"|<table|<tr|<a\b[^>]*href="[^"]*indeed\.com/i,
    );
    const context = boundary !== -1 ? afterLink.slice(0, boundary) : afterLink;

    let company = 'Unknown';
    const compMatch = context.match(
      /(?:class="[^"]*(?:company|companyName|jobsearch-Company)[^"]*"[^>]*>|<span[^>]*class="[^"]*company_location[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p|a)>/i,
    );
    if (compMatch?.[1]) {
      const c = stripHtml(compMatch[1]);
      if (c && c !== cleanTitle && c.length < 100) company = c;
    }

    let location = null;
    const locMatch =
      context.match(
        /(?:class="[^"]*(?:location|companyLocation|job-location)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
      ) || context.match(/(?:[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}(?:\s+\d{5})?|\bRemote\b|\bHybrid\b)/);
    if (locMatch) {
      const l = stripHtml(locMatch[1] || locMatch[0]);
      if (l && l !== cleanTitle && l !== company) location = l;
    }

    let salaryRaw = null;
    const salMatch = context.match(
      /([$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*[-–to/]\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?)?\s*(?:\/\s*(?:yr|year|mo|month|hr|hour)|\b(?:a\s+year|an\s+hour|a\s+month|per\s+year)\b))/i,
    );
    if (salMatch?.[1]) salaryRaw = stripHtml(salMatch[1]);

    jobs.push({ title: cleanTitle, company, location, salary_raw: salaryRaw, apply_url: applyUrl });
  }
  return jobs;
}

function parseFallback(html) {
  const jobs = [];
  const linkRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seen = new Set();

  while ((match = linkRegex.exec(html)) !== null) {
    const cleanTitle = stripHtml(match[2]);
    if (
      !cleanTitle ||
      cleanTitle.length < 3 ||
      /^(view|see|apply|read|click|more|unsubscribe|login|privacy|terms|help|preferences)/i.test(
        cleanTitle,
      )
    )
      continue;
    if (!match[1].startsWith('http://') && !match[1].startsWith('https://')) continue;
    const applyUrl = cleanTrackingUrl(match[1]);
    if (seen.has(applyUrl)) continue;
    seen.add(applyUrl);

    jobs.push({
      title: cleanTitle,
      company: 'Unknown',
      location: null,
      salary_raw: null,
      apply_url: applyUrl,
    });
  }
  return jobs;
}

async function main() {
  console.log(`Parsing file: ${resolvedPath}...`);
  const email = await new PostalMime().parse(rawEml);

  const sender = email.from?.address || 'Unknown';
  const recipient = (email.to || []).map((t) => t.address).join(', ') || 'Unknown';
  const portal = detectPortal(sender);

  console.log('--- Email Metadata ---');
  console.log(`From:    ${sender}`);
  console.log(`To:      ${recipient}`);
  console.log(`Subject: ${email.subject || '(no subject)'}`);
  console.log(`Portal:  ${portal}`);
  console.log('----------------------');

  const html = email.html || email.text || '';
  let jobs = [];
  switch (portal) {
    case 'linkedin':
      jobs = parseLinkedIn(html);
      break;
    case 'naukri':
      jobs = parseNaukri(html);
      break;
    case 'indeed':
      jobs = parseIndeed(html);
      break;
    case 'fallback':
    default:
      jobs = parseFallback(html);
      break;
  }

  console.log(`Extracted Jobs (${jobs.length}):\n`);
  jobs.forEach((job, index) => {
    console.log(`[Job #${index + 1}]`);
    console.log(`  Title:     ${job.title}`);
    console.log(`  Company:   ${job.company}`);
    console.log(`  Location:  ${job.location || 'None'}`);
    console.log(`  Salary:    ${job.salary_raw || 'None'}`);
    console.log(`  Apply URL: ${job.apply_url}`);
    console.log('');
  });
}

main().catch((err) => {
  console.error('Failed to parse email:', err);
  process.exit(1);
});
