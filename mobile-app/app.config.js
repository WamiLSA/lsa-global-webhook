const appJson = require('./app.json');

const apiBaseUrl = (
  process.env.LSA_MOBILE_API_BASE_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  appJson.expo.extra?.apiBaseUrl ||
  ''
).replace(/\/+$/, '');

module.exports = {
  ...appJson.expo,
  extra: {
    ...(appJson.expo.extra || {}),
    apiBaseUrl
  }
};
