import crypto from 'crypto';

/**
 * Encrypts a string using AES-256-CBC with a user-provided password
 */
export function encryptData(text: string, keyString: string): string {
  try {
    const key = crypto.createHash('sha256').update(keyString).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const payload = {
      type: 'sanaei_bot_secured_backup',
      iv: iv.toString('hex'),
      encryptedData: encrypted
    };
    
    return JSON.stringify(payload);
  } catch (e: any) {
    throw new Error('خطا در رمزگذاری بکاپ: ' + e.message);
  }
}

/**
 * Decrypts a password-secured backup payload
 */
export function decryptData(jsonStr: string, keyString: string): string {
  try {
    const payload = JSON.parse(jsonStr);
    if (payload.type !== 'sanaei_bot_secured_backup' || !payload.iv || !payload.encryptedData) {
      throw new Error('فرمت فایل پشتیبان نامعتبر است یا این فایل رمزگذاری شده مناسب نیست.');
    }
    
    const iv = Buffer.from(payload.iv, 'hex');
    const encrypted = Buffer.from(payload.encryptedData, 'hex');
    const key = crypto.createHash('sha256').update(keyString).digest();
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (e: any) {
    throw new Error('رمز عبور وارد شده نامعتبر است یا ساختار فایل خراب شده است.');
  }
}
