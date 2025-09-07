const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs").promises;
const path = require("path");
// const { fixJSON } = require('./utils/jsonFixer'); // Temporarily disabled
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Store reasoning data for admin dashboard
const reasoningStore = new Map();

async function loadPromptFiles() {
  const systemPrompt = await fs.readFile(
    path.join(__dirname, "prompts", "system_prompt.txt"),
    "utf8"
  );
  const rules = await fs.readFile(
    path.join(__dirname, "rulebook", "rules.txt"),
    "utf8"
  );
  const outputTemplate = await fs.readFile(
    path.join(__dirname, "prompts", "output_template.txt"),
    "utf8"
  );

  return { systemPrompt, rules, outputTemplate };
}

function generateDisputeId() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `DISP-${new Date().getFullYear()}-${timestamp}-${random}`;
}

function formatDisputePrompt(disputeData, disputeId) {
  // Format according to the AI Judge input format
  const evidenceArray = disputeData.submitted_evidence || [];

  return JSON.stringify(
    {
      dispute_id: disputeId,
      claimant_type: disputeData.claimant_type,
      statement_of_claim: disputeData.statement_of_claim,
      statement_of_defence: disputeData.statement_of_defence || "",
      dispute_category: disputeData.dispute_category,
      submitted_evidence: evidenceArray,
    },
    null,
    2
  );
}

app.post("/api/dispute", async (req, res) => {
  console.log("Received dispute request:", req.body);

  let disputeId = "N/A"; // Initialize disputeId outside try block

  try {
    const disputeData = req.body;
    disputeId = generateDisputeId();

    const { systemPrompt, rules, outputTemplate } = await loadPromptFiles();

    // Use the dispute amount from the form, or extract from claim if not provided
    const disputeAmount =
      disputeData.dispute_amount ||
      (() => {
        const amountMatch =
          disputeData.statement_of_claim.match(/\$?(\d+(?:\.\d{2})?)/);
        return amountMatch ? parseFloat(amountMatch[1]) : 100.0;
      })();

    // Simplified prompt focusing on the core requirements
    const fullPrompt = `You are an AI judge. Create a complete judicial decision for this dispute.

DISPUTE: ${disputeData.statement_of_claim}
CATEGORY: ${disputeData.dispute_category}
AMOUNT: $${disputeAmount}
DEFENCE: ${disputeData.statement_of_defence || "No defence provided"}

Generate the complete decision text in this EXACT format:

Decision Rendered: ${new Date().toISOString()}

I. SUMMARY OF DISPUTE

[Write 2-3 sentences summarizing the dispute between buyer and seller]

II. ESTABLISHED FACTS

Based on the evidence provided, the Tribunal finds that:
• [Fact 1 about the dispute]
• [Fact 2 about the dispute]
• [Fact 3 about the dispute]
• [Additional facts as needed]

III. EVIDENCE CONSIDERED

The Tribunal assessed, inter alia:
• [Evidence type 1] – [relevant notes about credibility/weight]
• [Evidence type 2] – [relevant notes about credibility/weight]
• [Additional evidence as needed]

IV. APPLICABLE RULES

This dispute is governed by the following provisions of the AI Judge™ Rules of Procedure:
• Article 5.3 – Burden of proof on claimant
• Article 5.4 – Adverse inference for withheld evidence
• Article 7.3 – Incorrect item procedures
• Article 8.1 – Remedy provisions
• [Additional relevant articles]

V. TRIBUNAL REASONING

[Write 3-4 paragraphs analyzing the dispute, applying the rules to the facts, and explaining your reasoning]

VI. RULING AND REMEDY

The Tribunal orders [specific remedy description] of $${disputeAmount} to the [Buyer/Seller].

Compliance deadline: ${new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000
    ).toISOString()} pursuant to Article 9.1.

VII. ADDITIONAL NOTES

Misconduct: [None / specific finding]

Confidence Score: [0.00-1.00]

[Additional notes about confidence level and appeal rights if applicable]

Return JSON with the complete formatted decision text:`;

    const jsonStructure = `{
  "decision": {
    "dispute_id": "${disputeId}",
    "dispute_category": "${disputeData.dispute_category}",
    "rules_applied": ["Article 5.3", "Article 5.4", "Article 7.3", "Article 8.1", "Article 13.1", "Article 17"],
    "confidence_score": 0.85,
    "finding_summary": "[PUT THE ENTIRE FORMATTED DECISION TEXT HERE - FROM 'Decision Rendered:' THROUGH THE END OF SECTION VII, INCLUDING ALL BULLET POINTS AND CONTENT]",
    "remedy_awarded": {
      "type": "full_refund", 
      "amount_usd": ${disputeAmount},
      "return_required": false,
      "notes": "Remedy pursuant to Article 8.1(a)"
    },
    "compliance_deadline": "${new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000
    ).toISOString()}",
    "misconduct_flag": {
      "misleading_conduct": false,
      "fraudulent_behavior": false, 
      "tier": null
    },
    "appealable": false
  }
}`;

    // Use Gemini with specific instructions for structured output
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.1, // Very low temperature for consistent formatting
        maxOutputTokens: 4000, // Increased for full decision text
      },
    });

    // Combine prompt and JSON structure
    const reasoningPrompt = fullPrompt + "\n\n" + jsonStructure;

    const result = await model.generateContent(reasoningPrompt);
    const response = await result.response;
    let text = response.text();

    // Sometimes Gemini adds extra content after the JSON
    // Try to extract just the JSON part
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");

    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      text = text.substring(jsonStart, jsonEnd + 1);
    }

    console.log("Raw AI response length:", text.length);

    let parsedDecision;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      let jsonText = jsonMatch ? jsonMatch[1] : text;

      // Temporarily disable JSON fixer
      // jsonText = fixJSON(jsonText);

      // One more attempt - try to parse and if it fails at a specific position,
      // truncate there and retry
      try {
        parsedDecision = JSON.parse(jsonText);
      } catch (firstError) {
        const match = firstError.message.match(/position (\d+)/);
        if (match) {
          const errorPos = parseInt(match[1]);
          console.warn(
            `JSON parse error at position ${errorPos}, attempting to fix...`
          );

          // Find the last complete JSON object before the error
          let depth = 0;
          let lastGoodPos = 0;

          for (let i = 0; i < Math.min(errorPos, jsonText.length); i++) {
            if (jsonText[i] === "{") depth++;
            else if (jsonText[i] === "}") {
              depth--;
              if (depth === 0) lastGoodPos = i;
            }
          }

          if (lastGoodPos > 0) {
            jsonText = jsonText.substring(0, lastGoodPos + 1);
            parsedDecision = JSON.parse(jsonText);
          } else {
            throw firstError;
          }
        } else {
          throw firstError;
        }
      }
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON.");
      console.error("Raw response:", text);
      console.error("Parse error:", parseError.message);

      // Try to provide more helpful error info
      if (text.includes("```")) {
        console.error("Response appears to contain markdown code blocks");
      }
      if (text.length > 1000) {
        console.error(
          "Response preview (first 1000 chars):",
          text.substring(0, 1000)
        );
      }

      throw new Error(`AI response was not valid JSON: ${parseError.message}`);
    }

    // Extract reasoning steps from the AI response
    const extractReasoningSteps = (decision) => {
      const steps = [];
      const findingSummary = decision.decision?.finding_summary || "";
      const rulesApplied = decision.decision?.rules_applied || [];
      const remedyType = decision.decision?.remedy_awarded?.type || "none";
      const remedyAmount = decision.decision?.remedy_awarded?.amount_usd || 0;

      // Extract key details from the claim
      const claimPreview = disputeData.statement_of_claim
        .substring(0, 150)
        .replace(/\n/g, " ")
        .trim();
      const defencePreview = disputeData.statement_of_defence
        ? disputeData.statement_of_defence
            .substring(0, 150)
            .replace(/\n/g, " ")
            .trim()
        : "No defence submitted";

      // Extract facts from finding summary if available
      const factsMatch = findingSummary.match(
        /ESTABLISHED FACTS[\s\S]*?(?=III\.|$)/i
      );
      const factsList = factsMatch
        ? factsMatch[0].match(/•\s*(.+)/g) || []
        : [];

      // Step 1: Initial Assessment with specific claim details
      steps.push({
        step: 1,
        title: "Initial Case Assessment",
        thought: `Reviewing the ${
          disputeData.claimant_type
        }'s claim: "${claimPreview}${
          disputeData.statement_of_claim.length > 150 ? "..." : ""
        }"`,
        conclusion: `This is a ${
          disputeData.dispute_category
        } dispute where the ${
          disputeData.claimant_type
        } seeks $${disputeAmount}. ${
          disputeData.dispute_category === "defective_item"
            ? "The claim involves allegedly defective merchandise."
            : disputeData.dispute_category === "non_delivery"
            ? "The claim involves items that were allegedly not delivered."
            : disputeData.dispute_category === "misrepresentation"
            ? "The claim involves alleged misrepresentation of goods/services."
            : "The claim involves a transaction dispute between parties."
        }`,
      });

      // Step 2: Evidence Review with specific evidence details
      const evidenceCount = disputeData.submitted_evidence?.length || 0;
      steps.push({
        step: 2,
        title: "Evidence Evaluation",
        thought: `Analyzing ${
          evidenceCount > 0
            ? `${evidenceCount} piece(s) of submitted evidence`
            : "the statements provided"
        } along with the ${
          disputeData.claimant_type === "Buyer" ? "Seller" : "Buyer"
        }'s response: "${defencePreview}${
          disputeData.statement_of_defence &&
          disputeData.statement_of_defence.length > 150
            ? "..."
            : ""
        }"`,
        conclusion: `${
          factsList.length > 0
            ? `Key findings: ${factsList
                .slice(0, 2)
                .join("; ")
                .replace(/•\s*/g, "")}`
            : "Evidence has been evaluated for credibility and relevance."
        }${
          decision.decision?.misconduct_flag?.misleading_conduct
            ? " Note: Indicators of misleading conduct were identified."
            : ""
        }`,
      });

      // Step 3: Rule Application with specific rules
      steps.push({
        step: 3,
        title: "Legal Framework Analysis",
        thought: `Applying procedural rules specific to ${disputeData.dispute_category.replace(
          /_/g,
          " "
        )} disputes, including ${
          rulesApplied.includes("Article 5.3")
            ? "burden of proof requirements"
            : ""
        }${
          rulesApplied.includes("Article 7.3")
            ? ", incorrect item procedures"
            : ""
        }${
          rulesApplied.includes("Article 8.1") ? ", and remedy provisions" : ""
        }.`,
        conclusion: `Applied ${
          rulesApplied.length
        } relevant rules: ${rulesApplied.slice(0, 3).join(", ")}${
          rulesApplied.length > 3
            ? ` and ${rulesApplied.length - 3} others`
            : ""
        }. ${
          disputeData.claimant_type === "Buyer"
            ? "The burden of proof rests with the Buyer to substantiate their claim."
            : "The Seller must demonstrate compliance with transaction terms."
        }`,
      });

      // Step 4: Decision Making with specific outcome
      const confidencePercent = (
        decision.decision?.confidence_score * 100
      ).toFixed(0);

      // Generate confidence reasoning based on various factors
      const getConfidenceReasoning = () => {
        const hasDefence =
          disputeData.statement_of_defence &&
          disputeData.statement_of_defence.trim().length > 0;
        const hasEvidence = evidenceCount > 0;
        const isMisconductFlagged =
          decision.decision?.misconduct_flag?.misleading_conduct ||
          decision.decision?.misconduct_flag?.fraudulent_behavior;

        if (confidencePercent >= 80) {
          if (!hasDefence) {
            return "The high confidence stems from the absence of a defence statement, which under Article 5.4 allows for adverse inference. The uncontested claims and evidence strongly support this ruling.";
          } else if (isMisconductFlagged) {
            return "The high confidence reflects clear indicators of misconduct identified in the submitted materials. The evidence overwhelmingly contradicts one party's claims, making the decision straightforward.";
          } else {
            return "The high confidence is due to consistent evidence alignment and clear application of relevant rules. Both parties' submissions were coherent, but the evidence strongly favored one side.";
          }
        } else if (confidencePercent >= 60) {
          if (!hasEvidence) {
            return "The moderate confidence reflects reliance primarily on party statements without supporting documentation. While the claims appear credible, additional evidence would have strengthened the determination.";
          } else {
            return "The moderate confidence indicates some conflicting elements in the evidence or partially applicable rules. The preponderance of evidence supports this ruling, though some uncertainties remain.";
          }
        } else {
          return "The lower confidence reflects significant gaps in evidence or conflicting statements that could not be fully resolved. This decision represents the most probable outcome based on available information, but substantial uncertainties exist.";
        }
      };

      steps.push({
        step: 4,
        title: "Final Decision Formulation",
        thought: `After weighing the evidence against applicable rules, considering ${
          confidencePercent >= 80
            ? "the strong evidence presented"
            : confidencePercent >= 60
            ? "the preponderance of evidence"
            : "the available evidence with some uncertainties"
        }, a determination has been reached. ${getConfidenceReasoning()}`,
        conclusion: `Ruling in favor of the ${
          remedyAmount > 0
            ? disputeData.claimant_type
            : disputeData.claimant_type === "Buyer"
            ? "Seller"
            : "Buyer"
        }. ${
          remedyType === "full_refund"
            ? `Full refund of $${remedyAmount} ordered.`
            : remedyType === "partial_refund"
            ? `Partial refund of $${remedyAmount} ordered.`
            : remedyType === "none"
            ? "No remedy awarded."
            : `${remedyType.replace(/_/g, " ")} of $${remedyAmount} ordered.`
        } Confidence level: ${confidencePercent}%.`,
      });

      return steps;
    };

    // Store reasoning data for admin dashboard
    const reasoningData = {
      disputeId: disputeId,
      timestamp: new Date().toISOString(),
      inputData: disputeData,
      promptSent: reasoningPrompt,
      aiResponse: parsedDecision,
      reasoningSteps: extractReasoningSteps(parsedDecision),
      processingTime: Date.now() - disputeData.startTime || 0,
    };

    reasoningStore.set(disputeId, reasoningData);

    // Return the decision
    res.json(parsedDecision);
  } catch (error) {
    console.error("Error processing dispute:", error);
    console.error(
      "Error details:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({
      error: "Failed to process dispute",
      details: error.message,
      disputeId: disputeId || "N/A",
    });
  }
});

// Enhanced health check endpoint
app.get("/api/health", async (req, res) => {
  const startTime = Date.now();

  try {
    // Check system status
    const healthStatus = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      service: "AI Judge Dispute Resolution API",
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      port: PORT,
      checks: {
        server: "healthy",
        gemini_api: "unknown",
        file_system: "unknown",
        memory: "healthy",
      },
    };

    // Check Gemini AI connectivity
    try {
      if (process.env.GEMINI_API_KEY) {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Health check test");
        await result.response;
        healthStatus.checks.gemini_api = "healthy";
      } else {
        healthStatus.checks.gemini_api = "no_api_key";
      }
    } catch (error) {
      healthStatus.checks.gemini_api = "unhealthy";
      healthStatus.checks.gemini_error = error.message;
    }

    // Check file system (prompts and rules)
    try {
      await fs.access(path.join(__dirname, "prompts", "system_prompt.txt"));
      await fs.access(path.join(__dirname, "rulebook", "rules.txt"));
      await fs.access(path.join(__dirname, "prompts", "output_template.txt"));
      healthStatus.checks.file_system = "healthy";
    } catch (error) {
      healthStatus.checks.file_system = "unhealthy";
      healthStatus.checks.file_error = error.message;
    }

    // Memory usage check
    const memUsage = process.memoryUsage();
    const memUsageMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
    };

    healthStatus.memory = memUsageMB;

    // Check if memory usage is concerning (>500MB heap)
    if (memUsageMB.heapUsed > 500) {
      healthStatus.checks.memory = "warning";
    }

    // Add dispute processing stats
    healthStatus.stats = {
      total_disputes_processed: reasoningStore.size,
      active_disputes: reasoningStore.size,
      response_time_ms: Date.now() - startTime,
    };

    // Overall health determination
    const unhealthyChecks = Object.values(healthStatus.checks).filter(
      (check) => check === "unhealthy" || check === "no_api_key"
    );

    if (unhealthyChecks.length > 0) {
      healthStatus.status = "degraded";
      if (
        healthStatus.checks.gemini_api === "no_api_key" ||
        healthStatus.checks.gemini_api === "unhealthy"
      ) {
        healthStatus.status = "unhealthy";
      }
    }

    const statusCode =
      healthStatus.status === "healthy"
        ? 200
        : healthStatus.status === "degraded"
        ? 200
        : 503;

    res.status(statusCode).json(healthStatus);
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message,
      response_time_ms: Date.now() - startTime,
    });
  }
});

// Simple health check for load balancers (returns 200 OK if server is running)
app.get("/api/health/simple", (req, res) => {
  res.status(200).send("OK");
});

// Admin endpoint to get reasoning data
app.get("/api/admin/reasoning/:disputeId", (req, res) => {
  const { disputeId } = req.params;
  const reasoningData = reasoningStore.get(disputeId);

  if (!reasoningData) {
    return res
      .status(404)
      .json({ error: "Reasoning data not found for this dispute" });
  }

  res.json(reasoningData);
});

// Admin endpoint to list all disputes
app.get("/api/admin/disputes", (req, res) => {
  const disputes = Array.from(reasoningStore.entries()).map(([id, data]) => ({
    disputeId: id,
    timestamp: data.timestamp,
    category: data.inputData.dispute_category,
    claimantType: data.inputData.claimant_type,
    confidence: data.aiResponse.decision.confidence_score,
  }));

  res.json(disputes);
});

// Test endpoint for Gemini
app.get("/api/test-gemini", async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(
      "Say 'Gemini is working!' in JSON format with a field called 'message'"
    );
    const response = await result.response;
    const text = response.text();
    res.json({ success: true, response: text });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response ? error.response.data : "No additional details",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Dispute resolution backend running on port ${PORT}`);
});
