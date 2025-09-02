# AI Dispute Resolution System - Backend

The backend server for the AI-powered dispute resolution system using GPT-4.

## Features

- **AI-Powered Dispute Processing**: Uses GPT-4 to analyze and resolve disputes
- **Modular Prompt System**: Easily updatable prompts and rulebook
- **RESTful API**: Clean endpoints for dispute submission and resolution
- **Structured Output**: Returns both human-readable and JSON formatted decisions
- **Confidence Scoring**: AI provides confidence levels for its decisions

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **AI Integration**: OpenAI GPT-4 API
- **Environment**: dotenv for configuration

## Project Structure

```
backend/
├── prompts/
│   ├── system_prompt.txt      # AI arbitrator behavior configuration
│   └── output_template.txt    # Decision output format
├── rulebook/
│   └── rules.txt             # Legal rules and guidelines
├── server.js                 # Main server file
├── package.json              # Dependencies and scripts
└── .env                      # Environment variables (create from .env.example)
```

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- OpenAI API key

### Installation

1. Navigate to the backend directory:

   ```bash
   cd backend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create environment configuration:

   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables in `.env`:
   ```env
   OPENAI_API_KEY=your_actual_api_key_here
   PORT=3001
   ```

### Running the Server

**Development mode:**

```bash
npm start
```

**Production mode:**

```bash
npm run start:prod
```

The server will start on the configured port (default: 3001).

## API Endpoints

### Health Check

- **GET** `/api/health` - Check backend health status

### Dispute Resolution

- **POST** `/api/dispute` - Submit a dispute for AI resolution

#### Dispute Request Body

```json
{
  "disputeId": "string",
  "category": "Contract|Service|Product|Other",
  "parties": "string",
  "establishedFacts": "string",
  "evidenceSummary": "string",
  "claimedRelief": "string"
}
```

#### Dispute Response

```json
{
  "decision": "string",
  "reasoning": "string",
  "remedy": "string",
  "confidence": "number",
  "applicableRules": ["string"],
  "timestamp": "string"
}
```

## Configuration

### Customizing AI Behavior

Edit `prompts/system_prompt.txt` to modify how the AI arbitrator behaves and makes decisions.

### Updating Legal Rules

Edit `rulebook/rules.txt` to modify the legal rules and guidelines used for dispute resolution.

### Changing Output Format

Edit `prompts/output_template.txt` to modify the structure and format of AI decisions.

## Environment Variables

| Variable         | Description         | Required | Default     |
| ---------------- | ------------------- | -------- | ----------- |
| `OPENAI_API_KEY` | Your OpenAI API key | Yes      | -           |
| `PORT`           | Server port         | No       | 3001        |
| `NODE_ENV`       | Environment mode    | No       | development |

## Development

### Available Scripts

- `npm start` - Start development server
- `npm run start:prod` - Start production server
- `npm test` - Run tests (if configured)
- `npm run lint` - Run linting (if configured)

### Adding New Features

1. **New API Endpoints**: Add routes in `server.js`
2. **Prompt Modifications**: Edit files in `prompts/` directory
3. **Rule Updates**: Modify `rulebook/rules.txt`
4. **Dependencies**: Add new packages via `npm install`

## Security Considerations

- Keep your OpenAI API key secure and never commit it to version control
- Use environment variables for sensitive configuration
- Consider implementing rate limiting for production use
- Validate all input data before processing

## Troubleshooting

### Common Issues

1. **API Key Error**: Ensure your OpenAI API key is correctly set in `.env`
2. **Port Already in Use**: Change the PORT in `.env` or kill the process using the port
3. **OpenAI Rate Limits**: Implement exponential backoff for production use

### Logs

Check the console output for detailed error messages and API responses.

## Contributing

1. Follow the existing code structure
2. Test your changes thoroughly
3. Update documentation as needed
4. Ensure all environment variables are documented

## License

[Add your license information here]
