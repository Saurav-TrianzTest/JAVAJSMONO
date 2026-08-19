import React, { createContext } from 'react';

// cz-js-1026 large state in React Context without externalization
const bigState = new Array(1000000).fill({ data: 'x' });
export const AppContext = createContext(bigState);

// cz-js-1031 in-memory session state in context/redux
export const session = { userId: null, token: null };

export function saveOrder(order) {
  // cz-js-1032 critical app state in localStorage
  localStorage.setItem('pendingOrder', JSON.stringify(order));
}
