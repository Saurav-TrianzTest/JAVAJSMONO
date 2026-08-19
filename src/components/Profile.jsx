import React from 'react';

export default function Profile() {
  // cz-js-1035 browser API access without typeof window check (SSR)
  const width = window.innerWidth;
  const theme = localStorage.getItem('theme');
  // cz-js-1036 no container env detection
  console.log('rendering profile');
  return <div>{width}{theme}</div>;
}
