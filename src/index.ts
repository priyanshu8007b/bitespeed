import express from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function initDB() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS Contact (
      id SERIAL PRIMARY KEY,
      phoneNumber VARCHAR(15),
      email VARCHAR(255),
      linkedId INT,
      linkPrecedence VARCHAR(10) CHECK (linkPrecedence IN ('primary', 'secondary')),
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deletedAt TIMESTAMP,
      FOREIGN KEY (linkedId) REFERENCES Contact(id)
    );
  `;
  await pool.query(createTableQuery);
}
initDB();

interface Contact {
  id: number;
  phoneNumber: string | null;
  email: string | null;
  linkedId: number | null;
  linkPrecedence: 'primary' | 'secondary';
  createdat: Date;
  updatedat: Date;
  deletedat?: Date | null;
}

app.post('/identify', async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;

    const existingContacts = await findContactsByEmailOrPhone(email, phoneNumber);

    if (existingContacts.length === 0) {
      const newContact = await createContact({
        email,
        phoneNumber,
        linkPrecedence: 'primary'
      });
      return res.json({
        contact: {
          primaryContactId: newContact.id,
          emails: [newContact.email].filter(e => e),
          phoneNumbers: [newContact.phoneNumber].filter(p => p),
          secondaryContactIds: []
        }
      });
    }

    const primaryContacts = existingContacts.filter(c => c.linkPrecedence === 'primary');
    const allLinkedContacts = await getAllLinkedContacts(existingContacts);
    
    const sortedPrimaries = [...primaryContacts].sort((a, b) => 
      new Date(a.createdat).getTime() - new Date(b.createdat).getTime()
    );
    const ultimatePrimary = sortedPrimaries[0];

    if (sortedPrimaries.length > 1) {
      for (let i = 1; i < sortedPrimaries.length; i++) {
        const primaryToDemote = sortedPrimaries[i];
        await updateContact(primaryToDemote.id, {
          linkedId: ultimatePrimary.id,
          linkPrecedence: 'secondary'
        });
        await updateSecondaryLinks(primaryToDemote.id, ultimatePrimary.id);
      }
    }

    const allEmails = getAllEmails(allLinkedContacts);
    const allPhones = getAllPhones(allLinkedContacts);

    const isNewEmail = email && !allEmails.includes(email);
    const isNewPhone = phoneNumber && !allPhones.includes(phoneNumber);

    if (isNewEmail || isNewPhone) {
      await createContact({
        email: isNewEmail ? email : null,
        phoneNumber: isNewPhone ? phoneNumber : null,
        linkedId: ultimatePrimary.id,
        linkPrecedence: 'secondary'
      });
    }

    const finalContacts = await getAllContactsLinkedToPrimary(ultimatePrimary.id);
    const response = buildResponse(finalContacts);
    res.json(response);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function findContactsByEmailOrPhone(email?: string, phone?: string): Promise<Contact[]> {
  if (!email && !phone) return [];
  const query = `
    SELECT * FROM Contact 
    WHERE (email = $1 OR phoneNumber = $2) AND deletedAt IS NULL
  `;
  const result = await pool.query(query, [email, phone]);
  return result.rows;
}

async function createContact(data: Partial<Contact>): Promise<Contact> {
  const { email, phoneNumber, linkedId, linkPrecedence } = data;
  const query = `
    INSERT INTO Contact (email, phoneNumber, linkedId, linkPrecedence, createdAt, updatedAt)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *
  `;
  const result = await pool.query(query, [email, phoneNumber, linkedId, linkPrecedence]);
  return result.rows[0];
}

async function updateContact(id: number, data: Partial<Contact>): Promise<void> {
  const { linkedId, linkPrecedence } = data;
  const query = `
    UPDATE Contact
    SET linkedId = $1, linkPrecedence = $2, updatedAt = NOW()
    WHERE id = $3
  `;
  await pool.query(query, [linkedId, linkPrecedence, id]);
}

async function updateSecondaryLinks(oldPrimaryId: number, newPrimaryId: number): Promise<void> {
  const query = `
    UPDATE Contact
    SET linkedId = $1, updatedAt = NOW()
    WHERE linkedId = $2
  `;
  await pool.query(query, [newPrimaryId, oldPrimaryId]);
}

async function getAllContactsLinkedToPrimary(primaryId: number): Promise<Contact[]> {
  const query = `
    SELECT * FROM Contact
    WHERE id = $1 OR linkedId = $1 AND deletedAt IS NULL
  `;
  const result = await pool.query(query, [primaryId]);
  return result.rows;
}

async function getAllLinkedContacts(contacts: Contact[]): Promise<Contact[]> {
  const primaryIds = contacts
    .filter(c => c.linkPrecedence === 'primary')
    .map(c => c.id);
  if (primaryIds.length === 0) return contacts;

  const query = `
    SELECT * FROM Contact
    WHERE linkedId = ANY($1::int[]) OR id = ANY($1::int[])
    AND deletedAt IS NULL
  `;
  const result = await pool.query(query, [primaryIds]);
  return result.rows;
}

function getAllEmails(contacts: Contact[]): string[] {
  const emails = contacts.map(c => c.email).filter(e => e !== null) as string[];
  return [...new Set(emails)];
}

function getAllPhones(contacts: Contact[]): string[] {
  const phones = contacts.map(c => c.phoneNumber).filter(p => p !== null) as string[];
  return [...new Set(phones)];
}

function buildResponse(contacts: Contact[]): any {
  const primary = contacts.find(c => c.linkPrecedence === 'primary')!;
  const secondaries = contacts.filter(c => c.linkPrecedence === 'secondary');
  return {
    contact: {
      primaryContactId: primary.id,
      emails: getAllEmails(contacts),
      phoneNumbers: getAllPhones(contacts),
      secondaryContactIds: secondaries.map(s => s.id)
    }
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});