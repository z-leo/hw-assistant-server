const axios = require('axios');
const config = require('../config');

async function code2Session(code) {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wxAppId}&secret=${config.wxAppSecret}&js_code=${code}&grant_type=authorization_code`;
  const res = await axios.get(url);
  if (res.data.errcode) {
    throw new Error(res.data.errmsg || `WeChat login failed with errcode ${res.data.errcode}`);
  }
  return res.data; // { openid, session_key, unionid }
}

module.exports = { code2Session };
