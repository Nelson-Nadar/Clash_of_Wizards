/**
 * Local event-network settings. Update HOST_IP whenever Windows assigns a new
 * USB-tethering address, then regenerate the mkcert certificate for that IP.
 */
module.exports = {
  HOST_IP: process.env.HOST_IP || '10.42.67.43',
  HTTPS_PORT: Number(process.env.HTTPS_PORT || 3000),
  CERT_FILE: process.env.HTTPS_CERT_FILE || 'certs/laser-fruit-slash.pem',
  KEY_FILE: process.env.HTTPS_KEY_FILE || 'certs/laser-fruit-slash-key.pem'
};
