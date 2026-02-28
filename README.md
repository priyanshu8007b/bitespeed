# bitespeed
Here's the complete README content to replace your existing `# bitespeed` line. Copy everything below and paste it into your `README.md` file, replacing the old content.

```markdown
# Bitespeed Identity Reconciliation

A backend service that identifies and consolidates customer contacts across multiple purchases, linking orders made with different contact information to the same person.

## Live Endpoint
`https://bitespeed-api-9xz4.onrender.com/identify`

## Technology Stack
- **Node.js** with **TypeScript**
- **Express** for the web framework
- **PostgreSQL** for database
- **Render** for deployment

## API Usage

### Endpoint
`POST /identify`

### Request Body
Send a JSON object with either or both fields:
```json
{
  "email": "customer@example.com",
  "phoneNumber": "1234567890"
}
```

### Response
Returns a consolidated contact object:
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["primary@example.com", "secondary@example.com"],
    "phoneNumbers": ["123456", "789012"],
    "secondaryContactIds": [2, 3]
  }
}
```

## How It Works
- When a request is received, the service searches for existing contacts matching the provided email or phone number.
- If no matching contact exists, a new **primary** contact is created.
- If matching contacts exist, the service identifies the oldest primary contact and links any new information as **secondary** contacts.
- If multiple primary contacts are found (indicating the same person used different contact details), they are merged into a single primary, with the oldest remaining primary and others demoted to secondary.
- The response always returns the complete consolidated contact information.

## Example

### Request
```bash
curl -X POST https://bitespeed-api-9xz4.onrender.com/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "marty@example.com", "phoneNumber": "123456"}'
```

### Response
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["doc@example.com", "marty@example.com"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2]
  }
}
```

## Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/priyanshu8007b/bitespeed.git
   cd bitespeed
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables (create a `.env` file):
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=your_user
   DB_PASSWORD=your_password
   DB_NAME=bitespeed
   PORT=3000
   ```

4. Run in development mode:
   ```bash
   npm run dev
   ```

5. Build for production:
   ```bash
   npm run build
   npm start
   ```

## Database Schema
The `Contact` table structure:
```sql
CREATE TABLE Contact (
  id SERIAL PRIMARY KEY,
  phonenumber VARCHAR(15),
  email VARCHAR(255),
  linkedid INT,
  linkprecedence VARCHAR(10) CHECK (linkprecedence IN ('primary', 'secondary')),
  createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updateat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deletedat TIMESTAMP,
  FOREIGN KEY (linkedid) REFERENCES Contact(id)
);
```

## Features Implemented
- Create primary contact for new customers
- Link secondary contacts when matching email/phone found
-Merge multiple primary contacts when overlap detected
- Return consolidated contact information in required format
-  Handle edge cases (no input, partial matches, etc.)

## Author
[Priyanshu Prakash]

## License
This project is created for the Bitespeed backend task.
```

**After pasting, save the file (Ctrl+S). Then commit and push to GitHub:**

```bash
git add README.md
git commit -m "Update README with project details"
git push origin main
```

