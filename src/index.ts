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
      phonenumber VARCHAR(15),
      email VARCHAR(255),
      linkedid INT,
      linkprecedence VARCHAR(10) CHECK (linkprecedence IN ('primary', 'secondary')),
      createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updateat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deletedat TIMESTAMP,
      FOREIGN KEY (linkedid) REFERENCES Contact(id)
    );
  `;
  await pool.query(createTableQuery);
}
initDB();

interface Contact {
  id: number;
  phonenumber: string | null;
  email: string | null;
  linkedid: number | null;
  linkprecedence: 'primary' | 'secondary';
  createdat: Date;
  updateat: Date;        // changed from updatedat to match column name
  deletedat?: Date | null;
}

app.post('/identify', async (req, res) => {
  try {
    const { email, phonenumber } = req.body;

    // Find contacts matching email OR phone
    const existingContacts = await findContactsByEmailOrPhone(email, phonenumber);

    // Case: No existing contact
    if (existingContacts.length === 0) {
      const newContact = await createContact({
        email,
        phonenumber,
        linkprecedence: 'primary'
      });
      return res.json({
        contact: {
          primaryContactId: newContact.id,
          emails: [newContact.email].filter(e => e),
          phoneNumbers: [newContact.phonenumber].filter(p => p),
          secondaryContactIds: []
        }
      });
    }

    // --- Step 1: Gather all primary contacts involved ---
    // Collect IDs of possible primary contacts (either direct primaries or linkedId of secondaries)
    const primaryIdSet = new Set<number>();
    existingContacts.forEach(c => {
      if (c.linkprecedence === 'primary') {
        primaryIdSet.add(c.id);
      } else if (c.linkedid) {
        primaryIdSet.add(c.linkedid);
      }
    });

    // Fetch those primary contacts from the database
    let primaryContactsFromDb: Contact[] = [];
    if (primaryIdSet.size > 0) {
      const primaryQuery = `
        SELECT * FROM Contact 
        WHERE id = ANY($1::int[]) AND deletedat IS NULL
      `;
      const result = await pool.query(primaryQuery, [Array.from(primaryIdSet)]);
      primaryContactsFromDb = result.rows;
    }

    // Combine and deduplicate all contacts we have
    const allContactsMap = new Map<number, Contact>();
    [...existingContacts, ...primaryContactsFromDb].forEach(c => allContactsMap.set(c.id, c));
    const allContacts = Array.from(allContactsMap.values());

    // --- Step 2: Determine the ultimate primary (oldest) ---
    const allPrimaryContacts = allContacts.filter(c => c.linkprecedence === 'primary');
    allPrimaryContacts.sort((a, b) => new Date(a.createdat).getTime() - new Date(b.createdat).getTime());
    const ultimatePrimary = allPrimaryContacts[0]; // guaranteed to exist because we have contacts

    // --- Step 3: Merge if multiple primaries exist ---
    if (allPrimaryContacts.length > 1) {
      for (let i = 1; i < allPrimaryContacts.length; i++) {
        const primaryToDemote = allPrimaryContacts[i];
        await updateContact(primaryToDemote.id, {
          linkedid: ultimatePrimary.id,
          linkprecedence: 'secondary'
        });
        // Update all secondaries of the demoted primary to point to the new ultimate primary
        await updateSecondaryLinks(primaryToDemote.id, ultimatePrimary.id);
      }
    }

    // --- Step 4: Check if new information is provided ---
    const allEmails = getAllEmails(allContacts);
    const allPhones = getAllPhones(allContacts);

    const isNewEmail = email && !allEmails.includes(email);
    const isNewPhone = phonenumber && !allPhones.includes(phonenumber);

    if (isNewEmail || isNewPhone) {
      await createContact({
        email: isNewEmail ? email : null,
        phonenumber: isNewPhone ? phonenumber : null,
        linkedid: ultimatePrimary.id,
        linkprecedence: 'secondary'
      });
    }

    // --- Step 5: Fetch final consolidated list and build response ---
    const finalContacts = await getAllContactsLinkedToPrimary(ultimatePrimary.id);
    const response = buildResponse(finalContacts);
    console.log('Response object:', JSON.stringify(response));
    res.json(response);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====================== Helper Functions ======================

async function findContactsByEmailOrPhone(email?: string, phone?: string): Promise<Contact[]> {
  if (!email && !phone) return [];
  const query = `
    SELECT * FROM Contact 
    WHERE (email = $1 OR phonenumber = $2) AND deletedat IS NULL
  `;
  const result = await pool.query(query, [email, phone]);
  return result.rows;
}

async function createContact(data: Partial<Contact>): Promise<Contact> {
  const { email, phonenumber, linkedid, linkprecedence } = data;
  const query = `
    INSERT INTO Contact (email, phonenumber, linkedid, linkprecedence, createdat, updateat)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *
  `;
  const result = await pool.query(query, [email, phonenumber, linkedid, linkprecedence]);
  return result.rows[0];
}

async function updateContact(id: number, data: Partial<Contact>): Promise<void> {
  const { linkedid, linkprecedence } = data;
  const query = `
    UPDATE Contact
    SET linkedid = $1, linkprecedence = $2, updateat = NOW()
    WHERE id = $3
  `;
  await pool.query(query, [linkedid, linkprecedence, id]);
}

async function updateSecondaryLinks(oldPrimaryId: number, newPrimaryId: number): Promise<void> {
  const query = `
    UPDATE Contact
    SET linkedid = $1, updateat = NOW()
    WHERE linkedid = $2
  `;
  await pool.query(query, [newPrimaryId, oldPrimaryId]);
}

async function getAllContactsLinkedToPrimary(primaryId: number): Promise<Contact[]> {
  // Corrected parentheses: (id = $1 OR linkedid = $1) AND deletedat IS NULL
  const query = `
    SELECT * FROM Contact
    WHERE (id = $1 OR linkedid = $1) AND deletedat IS NULL
  `;
  const result = await pool.query(query, [primaryId]);
  return result.rows;
}

// This function is no longer used in the main flow but kept for completeness.
// If you still use it elsewhere, fix the parentheses as shown.
async function getAllLinkedContacts(contacts: Contact[]): Promise<Contact[]> {
  const primaryIds = contacts
    .filter(c => c.linkprecedence === 'primary')
    .map(c => c.id);
  if (primaryIds.length === 0) return contacts;

  // Corrected parentheses
  const query = `
    SELECT * FROM Contact
    WHERE (linkedid = ANY($1::int[]) OR id = ANY($1::int[])) AND deletedat IS NULL
  `;
  const result = await pool.query(query, [primaryIds]);
  return result.rows;
}

function getAllEmails(contacts: Contact[]): string[] {
  const emails = contacts.map(c => c.email).filter(e => e !== null) as string[];
  return [...new Set(emails)];
}

function getAllPhones(contacts: Contact[]): string[] {
  const phones = contacts.map(c => c.phonenumber).filter(p => p !== null) as string[];
  return [...new Set(phones)];
}

function buildResponse(contacts: Contact[]): any {
  const primary = contacts.find(c => c.linkprecedence === 'primary')!;
  const secondaries = contacts.filter(c => c.linkprecedence === 'secondary');
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