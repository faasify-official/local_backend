// Script to create deployment ZIP for AWS Lambda
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

console.log('📦 Creating deployment package for AWS Lambda...\n')

// Check if node_modules exists
const nodeModulesPath = path.join(process.cwd(), 'node_modules')
if (!fs.existsSync(nodeModulesPath)) {
  console.error('❌ ERROR: node_modules folder not found!')
  console.log('\n💡 Please run: npm install')
  console.log('   Then try again: npm run package\n')
  process.exit(1)
}

// Check if @vendia/serverless-express is installed
const serverlessExpressPath = path.join(nodeModulesPath, '@vendia', 'serverless-express')
if (!fs.existsSync(serverlessExpressPath)) {
  console.error('❌ ERROR: @vendia/serverless-express not found in node_modules!')
  console.log('\n💡 Please run: npm install')
  console.log('   Then try again: npm run package\n')
  process.exit(1)
}

console.log('✅ Dependencies found\n')

// Files/folders to exclude from ZIP
const excludePatterns = [
  '*.git*',
  'node_modules/.cache',
  '*.zip',
  '.env',
  '*.log',
  '.DS_Store',
  'package-lock.json', // Optional - Lambda doesn't need it
  'README.md',
  'DEPLOY.md',
  'ENV-VARIABLES.md',
  'server.js', // Not needed in Lambda (we use lambda.js)
]

// Get the current directory
const currentDir = process.cwd()
const zipFile = path.join(currentDir, 'deployment.zip')

// Remove old ZIP if exists
if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile)
  console.log('🗑️  Removed old deployment.zip\n')
}

try {
  // Check if we're on Windows or Unix
  const isWindows = process.platform === 'win32'
  
  if (isWindows) {
    // Windows PowerShell approach - MUST include directories (node_modules)
    console.log('Using PowerShell to create ZIP...')
    console.log('📦 Including node_modules folder (required for Lambda)...')
    
    // Simple approach: compress everything including node_modules
    // This ensures all dependencies are included
    const command = `powershell -Command "Compress-Archive -Path * -DestinationPath deployment.zip -Force"`
    execSync(command, { cwd: currentDir, stdio: 'inherit' })
  } else {
    // Unix (Mac/Linux) approach
    console.log('Using zip command to create ZIP...')
    const excludeArgs = excludePatterns.map(p => `-x "${p}"`).join(' ')
    const command = `zip -r deployment.zip . ${excludeArgs}`
    execSync(command, { cwd: currentDir, stdio: 'inherit' })
  }
  
  // Check file size
  const stats = fs.statSync(zipFile)
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2)
  
  console.log('\n✅ Deployment package created successfully!')
  console.log(`📁 File: ${zipFile}`)
  console.log(`📊 Size: ${fileSizeMB} MB`)
  console.log('\n📤 Ready to upload to AWS Lambda!')
  console.log('   Handler: lambda.handler')
  console.log('   Runtime: Node.js 20.x (or 18.x)')
  
} catch (error) {
  console.error('\n❌ Error creating ZIP:', error.message)
  console.log('\n💡 Try creating ZIP manually:')
  console.log('   Windows: Compress-Archive -Path * -DestinationPath deployment.zip')
  console.log('   Mac/Linux: zip -r deployment.zip . -x "*.git*" "node_modules/.cache/*"')
  process.exit(1)
}

