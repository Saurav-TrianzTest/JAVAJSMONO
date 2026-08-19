// cz-js-1046 health check API route in Next.js
export default function handler(req, res) {
  res.status(200).json({ status: 'UP' });
}
