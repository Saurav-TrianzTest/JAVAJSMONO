import React, { lazy, useEffect, useState } from 'react';
// cz-js-1047 code splitting via React.lazy + dynamic import
const Heavy = lazy(() => import('./Heavy'));
// cz-js-1045 stateless component, all state via API
export default function Stateless() {
  const [items, setItems] = useState([]);
  useEffect(() => { fetch('/api/items').then(r => r.json()).then(setItems); }, []);
  return <Heavy items={items} />;
}
