
const PhoneEngine = require('./phone-engine.js')

async function start(){
  var phoneEngine = new PhoneEngine()
  await phoneEngine.initializePhoneEngine()
}

start()
