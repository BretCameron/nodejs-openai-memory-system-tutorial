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
const topics: Record<string, string[]> = {};

const encoding = encodingForModel("gpt-4");

const getPromptToDivideIntoCategories = (
  content: string
) => `Go through the following message and split it into smaller parts based on the different topics it covers. Your result should be a JSON object where the keys are the topics and the values are an array of strings representing the corresponding excerpts from the message. You can ignore any irrelevant details.

  You can use the following topics as a reference: ${Object.keys(topics).join(
    ", "
  )}

  Message:
  "${content}"
`;

const getPromptToChooseRelevantTopics = (
  question: string,
  topicNames: string[]
) => `Which of the following topics are relevant to the user's question? Give your answer as a JSON array of strings, where each string is a topic. If none of the topics are relevant, you can respond with an empty array. It is better to include more topics than necessary than to exclude relevant topics.

  Topics:
  "${topicNames.join(", ")}"

  Question:
  "${question}"
`;

const getRelevantTopics = async (question: string, topicNames: string[]) => {
  const prompt = getPromptToChooseRelevantTopics(question, topicNames);

  if (!topicNames.length) {
    return [];
  }

  const tokens = encoding.encode(JSON.stringify(topicNames)).length;

  const response = await client.chat.completions.create({
    model: "gpt-4",
    max_tokens: Math.max(tokens * 2, 100),
    messages: [
      {
        role: "system",
        content: prompt,
      },
    ],
  });

  const result = response.choices[0]?.message?.content || "[]";

  try {
    const parsed = JSON.parse(result) as string[];

    return parsed;
  } catch (e) {
    console.error("Failed to parse JSON: ", e);
    return [];
  }
};

async function anatomizeMessage(
  tokenCount: number,
  content: string,
  modelLimit = 8192,
  maxAttempts = 0,
  attemptCount = 0
) {
  const contentLimit = Math.floor(modelLimit / 3);

  if (tokenCount > contentLimit) {
    throw new Error(
      `The message is ${tokenCount} tokens, which is too long to process: please reduce it to ${contentLimit} tokens or less.`
    );
  }

  const response = await client.chat.completions.create({
    model: "gpt-4",
    max_tokens: Math.max(tokenCount * 2, 300),
    messages: [
      {
        role: "system",
        content: getPromptToDivideIntoCategories(content),
      },
    ],
  });

  const json = response.choices[0]?.message?.content || "{}";

  try {
    const parsed = JSON.parse(json) as Record<string, string[]>;

    for (const [topic, excerpts] of Object.entries(parsed)) {
      if (!topics[topic]) {
        topics[topic] = [];
      }

      topics[topic].push(...excerpts);
    }
  } catch (e) {
    console.error("Failed to parse JSON: ", e);

    if (attemptCount < maxAttempts) {
      await anatomizeMessage(
        tokenCount,
        content,
        modelLimit,
        maxAttempts,
        attemptCount + 1
      );
    } else {
      return {};
    }
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

    anatomizeMessage(answerTokenCount, answer);

    const relevantTopics = await getRelevantTopics(answer, Object.keys(topics));

    const relevantExcerpts = relevantTopics
      .map((topic) => topics[topic])
      .flat();

    const response = await client.chat.completions.create({
      model: "gpt-4",
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: `You are a helpful AI assistant. Answer the user's questions based on the following excerpts: ${relevantExcerpts.join(
            "; "
          )}`,
        } as Message,
        ...messageHistory.slice(-10).map(
          (x) =>
            ({
              role: x.role,
              content: x.content,
            } as Message)
        ),
      ],
      stream: true,
    });

    rl.write("AI:  ");

    let newContent = "";

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || "";

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

    anatomizeMessage(responseTokenCount, newContent);

    rl.write("\n\n");

    while (sum(messageHistory.map((x) => x.tokenCount)) > 1000) {
      messageHistory.shift();
    }

    console.log("Topics: ", topics);
  }

  rl.close();
}

function sum(nums: number[]) {
  return nums.reduce((acc, curr) => acc + curr, 0);
}

main();
