import { describe, it, expect } from 'vitest';
import { parseSalary } from './salary.js';

describe('Salary Parsing', () => {
  it('handles Indian LPA ranges', () => {
    const res = parseSalary('15 - 25 LPA');
    expect(res.salary_min).toBe(1500000);
    expect(res.salary_max).toBe(2500000);
    expect(res.currency).toBe('INR');
    expect(res.salary_raw).toBe('15 - 25 LPA');
  });

  it('handles single LPA amounts', () => {
    const res = parseSalary('20 LPA');
    expect(res.salary_min).toBe(2000000);
    expect(res.salary_max).toBe(2000000);
    expect(res.currency).toBe('INR');
  });

  it('handles Lakhs variant', () => {
    const res = parseSalary('18 - 24 Lakhs');
    expect(res.salary_min).toBe(1800000);
    expect(res.salary_max).toBe(2400000);
    expect(res.currency).toBe('INR');
  });

  it('handles USD ranges with k abbreviation', () => {
    const res = parseSalary('$120k - $150k');
    expect(res.salary_min).toBe(120000);
    expect(res.salary_max).toBe(150000);
    expect(res.currency).toBe('USD');
  });

  it('handles full numeric USD ranges', () => {
    const res = parseSalary('$120,000 - $150,000 USD');
    expect(res.salary_min).toBe(120000);
    expect(res.salary_max).toBe(150000);
    expect(res.currency).toBe('USD');
  });

  it('handles monthly salaries by annualizing (x12)', () => {
    const res = parseSalary('$5,000 / month');
    expect(res.salary_min).toBe(60000);
    expect(res.salary_max).toBe(60000);
    expect(res.currency).toBe('USD');

    const rangeRes = parseSalary('$5,000 - $7,000 per month');
    expect(rangeRes.salary_min).toBe(60000);
    expect(rangeRes.salary_max).toBe(84000);
  });

  it('handles GBP and EUR currencies', () => {
    const gbp = parseSalary('£60k - £80k');
    expect(gbp.salary_min).toBe(60000);
    expect(gbp.salary_max).toBe(80000);
    expect(gbp.currency).toBe('GBP');

    const eur = parseSalary('€80,000 - €100,000');
    expect(eur.salary_min).toBe(80000);
    expect(eur.salary_max).toBe(100000);
    expect(eur.currency).toBe('EUR');
  });

  it('handles missing or non-salary text gracefully', () => {
    expect(parseSalary(null)).toEqual({
      salary_min: null,
      salary_max: null,
      currency: null,
      salary_raw: null,
    });

    expect(parseSalary('')).toEqual({
      salary_min: null,
      salary_max: null,
      currency: null,
      salary_raw: null,
    });

    expect(parseSalary('Competitive')).toEqual({
      salary_min: null,
      salary_max: null,
      currency: null,
      salary_raw: 'Competitive',
    });

    expect(parseSalary('DOE (Depends on experience)')).toEqual({
      salary_min: null,
      salary_max: null,
      currency: null,
      salary_raw: 'DOE (Depends on experience)',
    });
  });
});
