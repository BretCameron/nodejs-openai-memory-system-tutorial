import { encodingForModel } from "js-tiktoken";
import dotenv from "dotenv";
import OpenAI from "openai";
import readline from "readline/promises";

dotenv.config();

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const client = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
  organization: process.env.OPEN_AI_ORG,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const encoding = encodingForModel("gpt-4");

const messageHistory: Message[] = [];
const tokenCounts: number[] = [];

async function main() {
  let shouldContinue = true;

  while (shouldContinue) {
    const answer = await rl.question("You: ");

    if (["exit", "quit", "close"].includes(answer.toLowerCase())) {
      shouldContinue = false;
      break;
    }

    messageHistory.push({ role: "user", content: answer } as Message);
    tokenCounts.push(encoding.encode(answer).length);

    const response = await client.chat.completions.create({
      model: "gpt-4",
      max_tokens: 300,
      messages: messageHistory,
      stream: true,
    });

    rl.write("AI:  ");

    let newContent = "";

    for await (const part of response) {
      const content = part.choices[0]?.delta?.content || "";

      newContent += content;
      rl.write(content);
    }

    messageHistory.push({ role: "assistant", content: newContent } as Message);
    tokenCounts.push(encoding.encode(newContent).length);

    rl.write("\n\n");

    while (sum(tokenCounts) > 100) {
      messageHistory.shift();
      tokenCounts.shift();
    }

    console.log("Token count: ", sum(tokenCounts));
    console.log("Message history: ", messageHistory);
  }

  rl.close();
}

function sum(nums: number[]) {
  return nums.reduce((acc, curr) => acc + curr, 0);
}

main();
