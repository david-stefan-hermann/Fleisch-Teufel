/** Prints a fresh VAPID key pair for the daily reminder (Web Push); put both into the stack's .env. */
import webPush from 'web-push';

const keys = webPush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
