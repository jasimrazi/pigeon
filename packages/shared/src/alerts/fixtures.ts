export const LINKEDIN_EML_FIXTURE = `From: "LinkedIn Job Alerts" <jobalerts-noreply@linkedin.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: 2 new jobs for 'Senior Systems Engineer'
Date: Tue, 04 Nov 2026 09:30:00 +0000
Message-ID: <alert-linkedin-12345@linkedin.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<head><title>LinkedIn Job Alert</title></head>
<body>
  <div>
    <h1>Jobs matching your alert: Senior Systems Engineer</h1>
    <table class="job-card">
      <tr>
        <td>
          <a href="https://www.linkedin.com/comm/jobs/view/3948572019?trk=eml-job-alert-member-detail&amp;trackingId=abc123xyz&amp;refId=ref789&amp;midToken=mid001">Senior Systems Engineer &amp; Architect</a>
          <div class="company-name">Acme Cloud Technologies Inc</div>
          <div class="job-location">San Francisco, CA (Remote)</div>
          <div class="salary-info">$150,000 - $180,000 / yr</div>
        </td>
      </tr>
    </table>
    <table class="job-card">
      <tr>
        <td>
          <a href="https://www.linkedin.com/jobs/view/3948572020?trk=eml-job-alert-member-detail&amp;trackingId=def456">Distributed Systems Specialist</a>
          <div class="company-name">Globex Corporation</div>
          <div class="job-location">New York, NY</div>
        </td>
      </tr>
    </table>
    <p><a href="https://www.linkedin.com/help/settings">Manage alerts</a></p>
  </div>
</body>
</html>
`;

export const NAUKRI_EML_FIXTURE = `From: "Naukri Job Alerts" <jobalerts@naukri.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: Recommended jobs matching your profile
Date: Tue, 04 Nov 2026 10:15:00 +0000
Message-ID: <alert-naukri-67890@naukri.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<head><title>Naukri Job Alert</title></head>
<body>
  <div>
    <h2>Custom Job Recommendations</h2>
    <div class="job-tuple">
      <a href="https://www.naukri.com/job-listings-full-stack-lead-initech-bengaluru-9876543210?src=jobsearchDesk&amp;sid=1726354&amp;xp=1&amp;px=1&amp;utm_source=alert"><b>Full Stack Lead Developer</b></a>
      <div class="comp-name">Initech India Pvt Ltd</div>
      <div class="loc">Bengaluru / Bangalore</div>
      <div class="salary">18-28 Lacs PA</div>
    </div>
    <div class="job-tuple">
      <a href="https://www.naukri.com/job-listings-devops-platform-engineer-hooli-hyderabad-9876543211?src=jobsearchDesk&amp;sid=1726354&amp;xp=2"><b>DevOps &amp; Platform Engineer</b></a>
      <div class="comp-name">Hooli Operations</div>
      <div class="loc">Hyderabad</div>
      <div class="salary">Not Disclosed</div>
    </div>
    <p><a href="https://www.naukri.com/unsubscribe">Unsubscribe</a></p>
  </div>
</body>
</html>
`;

export const INDEED_EML_FIXTURE = `From: "Indeed Job Alert" <alert@indeed.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: 2 new jobs for 'Backend Engineer'
Date: Tue, 04 Nov 2026 11:00:00 +0000
Message-ID: <alert-indeed-11223@indeed.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<head><title>Indeed Job Alert</title></head>
<body>
  <div>
    <h2>Jobs for Backend Engineer</h2>
    <div class="job-result">
      <a href="https://www.indeed.com/viewjob?jk=7a8b9c0d1e2f3a4b&amp;from=ia-ja&amp;tk=1h2j3k4l&amp;qd=98765&amp;utm_source=jobseeker-emails">Principal Software Engineer</a>
      <div class="companyName">Umbrella Corporation</div>
      <div class="companyLocation">Remote</div>
      <div class="salary-snippet">$160,000 - $200,000 a year</div>
    </div>
    <div class="job-result">
      <a href="https://www.indeed.com/viewjob?jk=5c6d7e8f9a0b1c2d&amp;from=ia-ja&amp;tk=1h2j3k4l">Site Reliability Engineer</a>
      <div class="companyName">Cyberdyne Systems</div>
      <div class="companyLocation">Austin, TX</div>
    </div>
    <p><a href="https://www.indeed.com/preferences">Manage your alerts</a></p>
  </div>
</body>
</html>
`;

export const EMPTY_EML_FIXTURE = `From: "LinkedIn Job Alerts" <jobalerts-noreply@linkedin.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: 0 new jobs for 'Rare Obscure Niche Skill'
Date: Tue, 04 Nov 2026 12:00:00 +0000
Message-ID: <alert-empty-99999@linkedin.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<head><title>LinkedIn Job Alert</title></head>
<body>
  <div>
    <h2>No new jobs found today matching your search criteria.</h2>
    <p>We will alert you as soon as new jobs are posted.</p>
    <p><a href="https://www.linkedin.com/help/settings">Manage search alerts</a></p>
  </div>
</body>
</html>
`;

export const UNAUTHORIZED_SENDER_EML_FIXTURE = `From: "Daily Job Blast" <promo@spam-job-offers.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: Urgent work from home offers!
Date: Tue, 04 Nov 2026 13:00:00 +0000
Message-ID: <spam-001@spam-job-offers.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <h1>Exclusive Job Offers Just For You</h1>
  <p><a href="https://spam-job-offers.com/click">Earn $5000/day working from home!</a></p>
</body>
</html>
`;

export const WRONG_FORWARDING_EML_FIXTURE = `From: "LinkedIn Job Alerts" <jobalerts-noreply@linkedin.com>
To: "Unknown User" <unauthorized-dest@wrongdomain.org>
Subject: 1 new job for 'Database Administrator'
Date: Tue, 04 Nov 2026 14:00:00 +0000
Message-ID: <alert-wrong-dest-1111@linkedin.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div>
    <a href="https://www.linkedin.com/jobs/view/999888777?trk=eml">Database Administrator</a>
    <div class="company-name">Wayne Enterprises</div>
  </div>
</body>
</html>
`;

export const WELLFOUND_EML_FIXTURE = `From: "Wellfound Job Matches" <matches@wellfound.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: Top startup matches: Senior Backend Engineer
Date: Tue, 04 Nov 2026 15:00:00 +0000
Message-ID: <alert-wellfound-001@wellfound.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div class="job-card">
    <a href="https://wellfound.com/jobs/3019284-senior-backend-engineer?utm_source=email_digest&amp;utm_campaign=matches">Senior Backend Engineer</a>
    <div class="startup-name">Supabase Scale Labs</div>
    <div class="location">San Francisco, CA (Remote)</div>
    <div class="salary">$160k – $190k • 0.2% equity</div>
  </div>
</body>
</html>
`;

export const OTTA_EML_FIXTURE = `From: "Otta" <recommendations@otta.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: New matches for you
Date: Tue, 04 Nov 2026 15:15:00 +0000
Message-ID: <alert-otta-002@otta.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div class="job-card">
    <a href="https://otta.com/jobs/staff-infrastructure-engineer-cloud-scale?utm_source=alert">Staff Infrastructure Engineer</a>
    <div class="company-name">Linear Orbit Inc</div>
    <div class="location">Remote</div>
    <div class="salary">$180,000 - $220,000 / year</div>
  </div>
</body>
</html>
`;

export const ZIPRECRUITER_EML_FIXTURE = `From: "ZipRecruiter Jobs" <jobs@ziprecruiter.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: Jobs you might like
Date: Tue, 04 Nov 2026 15:30:00 +0000
Message-ID: <alert-zip-003@ziprecruiter.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div class="job_item">
    <a href="https://www.ziprecruiter.com/jobs/cloud-systems-engineer-9988?jid=zr-1234&amp;utm_source=alert">Cloud Systems Engineer</a>
    <div class="hiring_company">Apex Defense Tech</div>
    <div class="location">Austin, TX</div>
    <div class="salary">$140,000 - $165,000 / year</div>
  </div>
</body>
</html>
`;

export const DICE_EML_FIXTURE = `From: "Dice Job Alerts" <alerts@dice.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: New Tech Jobs for 'DevOps Engineer'
Date: Tue, 04 Nov 2026 15:45:00 +0000
Message-ID: <alert-dice-004@dice.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div class="job">
    <a href="https://www.dice.com/job-detail/55443322-devops-architect?jobId=dice-99&amp;utm_source=dice">DevOps Architect</a>
    <div class="compName">Redwood Systems</div>
    <div class="location">Remote</div>
    <div class="salary">$150,000 - $175,000 / year</div>
  </div>
</body>
</html>
`;

export const GLASSDOOR_EML_FIXTURE = `From: "Glassdoor Alerts" <noreply@glassdoor.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: 1 new job alert for Site Reliability Engineer
Date: Tue, 04 Nov 2026 16:00:00 +0000
Message-ID: <alert-gd-005@glassdoor.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div class="job">
    <a href="https://www.glassdoor.com/job-listing/site-reliability-engineer-cloud-JL_1009988.htm?jl=1009988&amp;utm_source=gd">Site Reliability Engineer</a>
    <div class="employer">Stripe Global</div>
    <div class="location">Seattle, WA (Hybrid)</div>
    <div class="salary">$165,000 - $195,000 / year</div>
  </div>
</body>
</html>
`;

export const INSTAHYRE_EML_FIXTURE = `From: "Instahyre Opportunities" <jobs@instahyre.com>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: Opportunities matching your tech stack
Date: Tue, 04 Nov 2026 16:15:00 +0000
Message-ID: <alert-insta-006@instahyre.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div class="job">
    <a href="https://www.instahyre.com/job-182940-backend-lead-at-razorpay?utm_source=alert">Backend Lead Engineer</a>
    <div class="employer-name">Razorpay Software</div>
    <div class="location">Bengaluru</div>
    <div class="salary">35 - 50 LPA</div>
  </div>
</body>
</html>
`;

export const FOUNDIT_EML_FIXTURE = `From: "foundit Alerts" <alerts@foundit.in>
To: "Alex Mercer" <alex.mercer@example.com>
Subject: Recommended jobs for you
Date: Tue, 04 Nov 2026 16:30:00 +0000
Message-ID: <alert-foundit-007@foundit.in>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div class="job">
    <a href="https://www.foundit.in/job/principal-software-engineer-cloud-12345?utm_source=alert">Principal Software Engineer</a>
    <div class="comp-name">Infosys Digital</div>
    <div class="location">Hyderabad</div>
    <div class="salary">30 - 45 LPA</div>
  </div>
</body>
</html>
`;
