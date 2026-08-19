import React from 'react';
import { BrowserRouter } from 'react-router-dom';

// cz-js-1041 hardcoded react-router basename
export default function App() {
  return <BrowserRouter basename='/myapp'></BrowserRouter>;
}
