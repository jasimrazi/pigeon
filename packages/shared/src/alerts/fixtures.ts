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
