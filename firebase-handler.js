const admin = require('firebase-admin');

class FirebaseHandler {
  constructor() {
    this.initialized = false;
    this.db = null;
    
    try {
      // Initialize Firebase Admin with credentials from environment
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : null;
      
      if (serviceAccount) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        
        this.db = admin.firestore();
        this.initialized = true;
        console.log('[Firebase] ✅ Initialized successfully');
      } else {
        console.warn('[Firebase] ⚠️ No credentials - using local JSON fallback');
      }
    } catch (error) {
      console.error('[Firebase] ❌ Initialization failed:', error.message);
    }
  }
  
  isConfigured() {
    return this.initialized;
  }
  
  /**
   * Get client data by phone number
   */
  async getClient(phoneNumber) {
    if (!this.initialized) return null;
    
    try {
      const doc = await this.db.collection('clients').doc(phoneNumber).get();
      
      if (doc.exists) {
        const data = doc.data();
        console.log('[Firebase] Client found:', phoneNumber, data.name);
        return data;
      }
      
      return null;
    } catch (error) {
      console.error('[Firebase] Error getting client:', error);
      return null;
    }
  }
  
  /**
   * Save or update client data
   */
  async saveClient(phoneNumber, clientData) {
    if (!this.initialized) return false;
    
    try {
      const docRef = this.db.collection('clients').doc(phoneNumber);
      const doc = await docRef.get();
      
      const now = new Date().toISOString();
      
      if (doc.exists) {
        // Update existing client
        const existing = doc.data();
        await docRef.update({
          ...clientData,
          lastCall: now,
          totalCalls: (existing.totalCalls || 0) + 1,
          updatedAt: now
        });
        console.log('[Firebase] Client updated:', phoneNumber);
      } else {
        // Create new client
        await docRef.set({
          ...clientData,
          phone: phoneNumber,
          firstCall: now,
          lastCall: now,
          totalCalls: 1,
          createdAt: now,
          updatedAt: now
        });
        console.log('[Firebase] Client created:', phoneNumber);
      }
      
      return true;
    } catch (error) {
      console.error('[Firebase] Error saving client:', error);
      return false;
    }
  }
  
  /**
   * Add event to client history
   */
  async saveEvent(phoneNumber, eventData) {
    if (!this.initialized) return false;
    
    try {
      const docRef = this.db.collection('clients').doc(phoneNumber);
      const doc = await docRef.get();
      
      if (!doc.exists) {
        console.warn('[Firebase] Client not found, creating...');
        await this.saveClient(phoneNumber, { name: eventData.clientName || 'Unknown' });
      }
      
      const event = {
        ...eventData,
        timestamp: new Date().toISOString()
      };
      
      await docRef.update({
        events: admin.firestore.FieldValue.arrayUnion(event),
        updatedAt: new Date().toISOString()
      });
      
      console.log('[Firebase] Event saved:', phoneNumber, eventData.date);
      return true;
    } catch (error) {
      console.error('[Firebase] Error saving event:', error);
      return false;
    }
  }
  
  /**
   * Calculate next birthday and age
   */
  calculateNextBirthday(birthDate) {
    const today = new Date();
    const birth = new Date(birthDate);
    
    // Calculate current age
    let currentAge = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      currentAge--;
    }
    
    // Calculate next birthday
    const nextBirthday = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
    if (nextBirthday < today) {
      nextBirthday.setFullYear(today.getFullYear() + 1);
    }
    
    const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
    const nextAge = currentAge + 1;
    
    return {
      currentAge,
      nextAge,
      nextBirthday: nextBirthday.toISOString().split('T')[0],
      daysUntil,
      isUpcoming: daysUntil <= 60 // Within 2 months
    };
  }
  
  /**
   * Build intelligent context for AI from client data
   */
  buildClientContext(clientData) {
    if (!clientData) return null;
    
    let context = `CLIENT CUNOSCUT: ${clientData.name}\n`;
    context += `Telefon: ${clientData.phone}\n`;
    context += `Apeluri: ${clientData.totalCalls || 1}\n`;
    
    if (clientData.lastCall) {
      const lastCall = new Date(clientData.lastCall);
      const daysSince = Math.floor((new Date() - lastCall) / (1000 * 60 * 60 * 24));
      context += `Ultimul apel: acum ${daysSince} zile\n`;
    }
    
    // Children info
    if (clientData.children && clientData.children.length > 0) {
      context += `\nCOPII:\n`;
      clientData.children.forEach(child => {
        const birthday = this.calculateNextBirthday(child.birthDate);
        context += `- ${child.name}: ${birthday.currentAge} ani (naștere: ${child.birthDate})\n`;
        context += `  Următoarea zi: ${birthday.nextBirthday} (${birthday.nextAge} ani, peste ${birthday.daysUntil} zile)\n`;
        
        if (birthday.isUpcoming) {
          context += `  ⚠️ SE APROPIE ZIUA! Menționează: "Bănuiesc că ai sunat pentru ziua lui ${child.name} care face ${birthday.nextAge} ani?"\n`;
        }
      });
    }
    
    // Events history
    if (clientData.events && clientData.events.length > 0) {
      context += `\nISTORIC EVENIMENTE:\n`;
      const sortedEvents = [...clientData.events].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
      );
      
      sortedEvents.slice(0, 3).forEach((event, idx) => {
        if (idx === 0) context += `Ultimul eveniment:\n`;
        context += `- ${event.date}: ${event.childName || 'N/A'} (${event.childAge || 'N/A'} ani)\n`;
        context += `  Locație: ${event.location || 'N/A'}\n`;
        context += `  Pachet: ${event.package || 'N/A'} (${event.price || 'N/A'} lei)\n`;
        if (event.services) {
          context += `  Servicii: ${event.services.join(', ')}\n`;
        }
        if (event.feedback) {
          context += `  Feedback: "${event.feedback}"\n`;
        }
        
        if (idx === 0) {
          context += `  💡 Sugestie: "Ultima dată ai avut la ${event.location}, a fost ok acolo?"\n`;
          context += `  💡 Sugestie: "Anul trecut ai luat ${event.package}, vrei același lucru?"\n`;
        }
      });
    }
    
    return context;
  }
}

module.exports = FirebaseHandler;
