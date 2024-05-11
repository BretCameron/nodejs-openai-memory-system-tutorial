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

const messageHistory: Message[] = [];

async function main() {
  while (true) {
    const answer = await rl.question("You: ");

    if (["exit", "quit", "close"].includes(answer.toLowerCase())) {
      break;
    }

    messageHistory.push({ role: "user", content: answer } as Message);

    const response = await client.chat.completions.create({
      model: "gpt-4",
      max_tokens: 300,
      messages: messageHistory,
      stream: true,
    });

    rl.write("AI:  ");

    let newContent = "";

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || "";

      newContent += content;
      rl.write(content);
    }

    messageHistory.push({ role: "assistant", content: newContent } as Message);

    rl.write("\n\n");
  }

  rl.close();
}

main();
