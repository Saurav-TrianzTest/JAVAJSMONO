// cz-js-1034 build-time REACT_APP_* env vars compiled into bundle
export const config = {
  apiUrl: process.env.REACT_APP_API_URL,  // baked at build time
  feature: process.env.REACT_APP_FEATURE_FLAG,
};
