module.exports = {
  port: 3300,

  // WeChat Mini Program
  wxAppId: process.env.WX_APP_ID || 'wx0ba2cdef01f13e91',
  wxAppSecret: process.env.WX_APP_SECRET || 'e117446b457078d3ae594c54b268f994',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'homework-assistant-secret-key-2026',

  // DashScope (通义千问VL)
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || 'sk-06e015b2fd10426fae5b7d1614568ba8',
  dashscopeModel: 'qwen-vl-max',
  dashscopeEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',

  // Server酱
  serverChanKey: process.env.SERVERCHAN_KEY || 'SCT414186TGmF0WIp0R8uGukYDQIcLVsLx',

  // Upload
  uploadDir: './uploads',
  maxFileSize: 10 * 1024 * 1024, // 10MB
};
