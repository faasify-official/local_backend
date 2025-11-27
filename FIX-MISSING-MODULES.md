# Fix: "Cannot find module '@vendia/serverless-express'"

This error means `node_modules` wasn't included in your ZIP file.

## Quick Fix

1. **Make sure dependencies are installed:**
   ```bash
   cd localBackend
   npm install
   ```

2. **Verify @vendia/serverless-express is installed:**
   ```bash
   npm list @vendia/serverless-express
   ```
   Should show the package version.

3. **Create a new ZIP with node_modules:**
   ```bash
   npm run package
   ```

4. **Verify node_modules is in the ZIP:**
   - Open `deployment.zip` 
   - Check that `node_modules/@vendia/serverless-express` exists inside

5. **Upload the new ZIP to Lambda:**
   - Go to Lambda Console → Your Function
   - Code → Upload from → .zip file
   - Select `deployment.zip`
   - Click Save
   - Click Deploy

## Manual ZIP Creation (if script doesn't work)

### Windows PowerShell:
```powershell
cd localBackend
Compress-Archive -Path * -DestinationPath deployment.zip -Force
```

### Mac/Linux:
```bash
cd localBackend
zip -r deployment.zip . -x "*.git*" "node_modules/.cache/*" "*.zip"
```

**Important:** Make sure `node_modules` folder is included!

## Check ZIP Contents

After creating the ZIP, verify it contains:
- ✅ `node_modules/` folder (with all dependencies)
- ✅ `lambda.js`
- ✅ `app.js`
- ✅ `routes/` folder
- ✅ `utils/` folder
- ✅ `middleware/` folder
- ✅ `package.json`

## Expected ZIP Size

Your ZIP should be **10-50 MB** (depending on dependencies). If it's only a few KB, `node_modules` is missing!

## Still Having Issues?

1. Check you're in the `localBackend` directory
2. Run `npm install` again
3. Check `node_modules/@vendia/serverless-express` exists
4. Create ZIP manually using the commands above

