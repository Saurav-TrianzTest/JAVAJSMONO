import axios from 'axios';

export function uploadToDisk(file) {
  // cz-js-1025 file upload to local container filesystem
  const fs = require('fs');
  fs.writeFileSync('/app/build/uploads/' + file.name, file);
}

export function getData() {
  // cz-js-1027 hardcoded API port
  return fetch('http://backend:8080/api/data');
}
export function getLocal() {
  // cz-js-1028 localhost URL
  return fetch('http://localhost:3001/api/info');
}
export function getCross() {
  // cz-js-1030 fetch without CORS error handling
  return fetch('http://api.other-origin.com/data').then(r => r.json());
}
