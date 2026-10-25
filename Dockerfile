FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install

# Install Playwright browsers inside image
RUN npx playwright install chromium

# Copy application source
COPY . .

# Expose API and Dashboard port
EXPOSE 5055

ENV PORT=5055
ENV NODE_ENV=production

CMD ["npm", "start"]
