const WS = require('ws')
const request = require('request')

const { IamAuthenticator } = require('ibm-watson/auth');

var fiftynineMinute = 59
var english_language_model = 'en-US_NarrowbandModel'
var eng_wsURI = '';


getWatsonToken()

setInterval(function(){
  fiftynineMinute--
  if (fiftynineMinute <= 1){
    getWatsonToken()
    fiftynineMinute = 59
    console.log("refresh watson token")
  }
}, 60000)

function getWatsonToken(){
  const wsURI = `wss://api.us-south.speech-to-text.watson.cloud.ibm.com/instances/${process.env.STT_INSTANCE_ID}/v1/recognize?access_token=`
  request.post("https://iam.cloud.ibm.com/identity/token", {
    form:
      { grant_type:'urn:ibm:params:oauth:grant-type:apikey',
        apikey: process.env.WATSON_SPEECH2TEXT_API_KEY
      }
    },
    function(error, response, body) {
      var jsonObj = JSON.parse(body)
      eng_wsURI = wsURI + jsonObj.access_token + '&model=en-US_NarrowbandModel'
    });
}

//
function WatsonEngine() {
  this.ws = null
  return this
}

WatsonEngine.prototype = {
  createWatsonSocket: function(callback){
    this.ws = new WS(eng_wsURI);
    var configs = {
      'action': 'start',
      'content-type': 'audio/mulaw;rate=8000;channels=1',
      'timestamps': false,
      'interim_results': true,
      'low_latency': true,
      'inactivity_timeout': -1,
      'smart_formatting': true,
      'speaker_labels': false
    };

    var thisClass = this
    this.ws.onopen = function(evt) {
      console.log("Watson Socket open")
      thisClass.ws.send(JSON.stringify(configs));
      callback("READY", "READY")
    };

    this.ws.onclose = function(data) {
      console.log("Watson Socket closed.")
    };
    this.ws.onconnection = function(evt) {
      console.log("Watson Socket connected.")
    };

    this.ws.onerror = function(evt) {
      console.log("Watson Socket error.")
      console.log(evt)
      callback("ERROR", evt)
    };
    this.ws.on('message', function(evt) {
      var res = JSON.parse(evt)
      if (res.hasOwnProperty('results')){
        if (res.results[0].final){
          var transcript = res.results[0].alternatives[0].transcript
          transcript = transcript.trim().replace(/%HESITATION/g, "")
          callback("FINAL", transcript)
        }else{
          callback("INTERIM")
        }
      }
    });
  },
  closeConnection: function(){
    this.ws.close()
  },
  transcribe: function(bufferStream) {
    this.ws.send(bufferStream, {
      binary: true,
      mask: true,
    });
  }
}
module.exports = WatsonEngine;
