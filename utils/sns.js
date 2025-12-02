const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns')

const snsConfig = {
  region: process.env.AWS_REGION || 'us-west-2',
}

const snsClient = new SNSClient(snsConfig)

/**
 * Send an SMS using Amazon SNS
 * @param {string} phoneNumber - E.164 format, e.g. "+16045551234"
 * @param {string} message
 */
async function sendSms(phoneNumber, message) {
  if (!phoneNumber || !message) {
    console.warn('sendSms called without phoneNumber or message')
    return
  }

  try {
    const command = new PublishCommand({
      PhoneNumber: phoneNumber,
      Message: message,
    })

    const result = await snsClient.send(command)
    console.log('SNS SMS sent', { phoneNumber, messageId: result.MessageId })

    return result
  } catch (error) {
    console.error('Error sending SMS via SNS:', error)
    throw error
  }
}

module.exports = { snsClient, sendSms }
