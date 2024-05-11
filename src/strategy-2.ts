import { encodingForModel } from "js-tiktoken";
import dotenv from "dotenv";
import ObjectID from "bson-objectid";
import OpenAI from "openai";
import readline from "readline/promises";

dotenv.config();

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

type StoredMessage = Message & {
  id: ObjectID;
  tokenCount: number;
};

const client = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
  organization: process.env.OPEN_AI_ORG,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messageHistory: StoredMessage[] = [];

const encoding = encodingForModel("gpt-4");

async function summarizeMessage(
  id: ObjectID,
  tokenCount: number,
  content: string
) {
  const response = await client.chat.completions.create({
    model: "gpt-4",
    max_tokens: Math.max(tokenCount, 100),
    messages: [
      {
        role: "system",
        content: `Summarize the following message, cutting out any unnecessary details:
        
        ${content}`,
      },
    ],
  });

  const summary = response.choices[0]?.message?.content || "";
  const summaryTokenCount = encoding.encode(summary).length;

  if (summaryTokenCount < tokenCount) {
    const messageIndex = messageHistory.findIndex(
      (x) => x.id.toHexString() === id.toHexString()
    );
    messageHistory[messageIndex].content = summary;
    messageHistory[messageIndex].tokenCount = summaryTokenCount;
  }
}

async function main() {
  let shouldContinue = true;

  while (shouldContinue) {
    const answer = await rl.question("You: ");

    if (["exit", "quit", "close"].includes(answer.toLowerCase())) {
      shouldContinue = false;
      break;
    }

    const answerId = new ObjectID();
    const answerTokenCount = encoding.encode(answer).length;

    messageHistory.push({
      role: "user",
      content: answer,
      id: answerId,
      tokenCount: answerTokenCount,
    } as StoredMessage);

    summarizeMessage(answerId, answerTokenCount, answer);

    const response = await client.chat.completions.create({
      model: "gpt-4",
      max_tokens: 300,
      messages: messageHistory.map(
        (x) =>
          ({
            role: x.role,
            content: x.content,
          } as Message)
      ),
      stream: true,
    });

    rl.write("AI:  ");

    let newContent = "";

    for await (const part of response) {
      const content = part.choices[0]?.delta?.content || "";

      newContent += content;
      rl.write(content);
    }

    const responseId = new ObjectID();
    const responseTokenCount = encoding.encode(newContent).length;

    messageHistory.push({
      role: "assistant",
      content: newContent,
      id: responseId,
      tokenCount: responseTokenCount,
    } as StoredMessage);

    summarizeMessage(responseId, responseTokenCount, newContent);

    rl.write("\n\n");

    while (sum(messageHistory.map((x) => x.tokenCount)) > 1000) {
      messageHistory.shift();
    }

    console.log("Message history: ", messageHistory);
  }

  rl.close();
}

function sum(nums: number[]) {
  return nums.reduce((acc, curr) => acc + curr, 0);
}

main();
