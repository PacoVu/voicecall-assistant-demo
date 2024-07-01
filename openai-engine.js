const WaveFile = require('wavefile').WaveFile;
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.GPT_API_KEY
});

function OpenAIEngine() {
  this.waveEngine = new WaveFile();
  return this
}

OpenAIEngine.prototype = {
  getClassifiedTask: async function(responseMode, message){
    try{
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            {
              "role": "user",
              "content": message,
              //"temperature": 0.3
            }
          ]
      });
      let text = completion.choices[0].message.content
      return JSON.parse(text)

    }catch(e){
      console.log(e.message)
      return null
    }
  },
  getIntents: async function(message){
    var message = `Determine the intent from the text between the triple dashes ---${message}---. Provide the response in JSON format where the key is "intent" and the value is "request" or "answer" or "question", or the value is "neutral" if it is none of the predefined intents.`
    message += ' 1. Then provide also the topic of the text, where the key is "topic" and the value is either "ordering", or "technical support", or "billing", or any free text if it is none of the predefined topics.'
    message += ' 2. If the intent is a "request", classify the text and provide the classification where the key is "class" and the classified value is either "call transfer", or "billing inquiry", or "order inquiry",'
    message += ' or "unclassified" if it is not one of those specified classifications. If the "class" value is "unclassified", provide a short utterance to continue the conversation relating to the topic, where the key is "ask" and the value is the best sentence.'
    message += ' 3. If the intent is a "question", provide the answer to the question where the key is "answer" and the value is the best short answer.'
    message += ' 4. If the intent is an "answer", provide a proper sentence to continue the conversation relating to the topic, where the key is "ask" and the value is the best utterance to continue the conversation.'
    return await this.getClassifiedTask("JSON", message)
  },
  getYesOrNoAnswer: async function(message){
    var message = `Determine if the text between the triple dashes means a "yes" or a "no" ---${message}---.`
    message += 'Provide in JSON format where the key is "answer" and the value is either 1 for a "yes" or 0 for a "no", or -1 if the answer is neutral.'
    return await this.getClassifiedTask("JSON", message)
  },
  getCodeVerification: async function(message, code){
    var message = `Find a number from the text between the triple dashes and compare it with the number from the text between the triple hashes ---${message}---, ###${code}###.`
    message +=  'Provide in JSON format where the key is "matched" and the value is true if the numbers are equal or false if they are not equal. And the second key is "number" and the value is the detected number.'
    return await this.getClassifiedTask("JSON", message)
  },
  getSpeech: async function (message){
    try{
      const response = await openai.audio.speech.create({
        model: 'tts-1',
        input: message,
        voice: "alloy",
        response_format: "wav"
      });

      const stream = response.body;
      var buf = await this._streamToBuf(stream);
      buf = await this._convertWave(buf)
      return buf
    }catch(e){
      console.log(e.message)
    }
  },
  _streamToBuf: async function(stream) {
    return new Promise((resolve, reject) => {
      var buffers = []
      stream.on('data', (chunk) => {buffers.push(chunk)});
      stream.on('end', () => {
        var buf = Buffer.concat(buffers);
        resolve(buf)
      })
      stream.on('error', (error) => {
        reject(error);
      })

    });
  },
  _convertWave: async function(buffer){
    let wav = new WaveFile();
    wav.fromBuffer(buffer)
    wav.toSampleRate(8000);
    wav.toMuLaw();
    return Buffer.from(wav.toBuffer())
  }
}
module.exports = OpenAIEngine;
