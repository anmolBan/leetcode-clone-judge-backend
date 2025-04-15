import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { Worker } from 'worker_threads'; // Use Worker threads
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(cors());
const port = process.env.PORT || 3001;

app.use(bodyParser.json());

interface TestCase {
  input: JSON;
  output: {output : JSON};
}

app.post('/submit-code', async (req: any, res: any) => {
  const { userId, problemId, code, language } = req.body;
  let success = true;
  let error = null;

  try {
    if (!code) {
      return res.status(400).json({ error: 'Missing code.' });
    }

    if (language !== 'JAVASCRIPT') {
      return res.status(400).json({ error: 'Unsupported language.' });
    }

    const newRes= await axios.get(`${process.env.BACKEND}/api/routes/getTestCases?problemId=${problemId}`);
    if(!newRes.data.testCases){
      return res.status(400).json({ error: 'Missing test cases.'});
    }

    const testCases = newRes.data.testCases;

    const results = await runCodeInWorker(code, testCases);
    for(let i = 0; i < results.length; i++){
      if(!results[i].passed){
        success = false;
        error = results[i].error;
        break;
      }
    }
    const correctCode = code.toString();
    await axios.post(`${process.env.BACKEND}/api/routes/submission`,
      {
        userId,
        problemId,
        code: correctCode,
        language,
        solved: success,
        status: success ? "ACCEPTED" : (error ? error : "WRONG_ANSWER")
      }
    );
    if(error){
      return res.json({success, results, error});
    }
    else{
      if(success){
        return res.json({success, results});
      }
      return res.json({success, results, error: "Wrong Answer"});
    }
  } catch (error) {
    console.error('Error running code:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

function runCodeInWorker(
  code: string,
  testCases: TestCase[],
): Promise<{ testCase: number; passed: boolean; result?: any; error?: string; expectedOutput: any }[]> {
  return new Promise((resolve) => {
    const worker = new Worker(`
      const { parentPort } = require('worker_threads');

      parentPort.on('message', async ({ code, testCases }) => {
        try {
          const dynamicFunction = eval('(' + code + ')');
          const results = [];
          
          for (let i = 0; i < testCases.length; i++) {
            const { input, output } = testCases[i];
            const expectedOutput = output.output;
            try {
              const inputValues = Object.values(input);
              const result = dynamicFunction(...inputValues);
              const passed = JSON.stringify(result) === JSON.stringify(output.output);
              results.push({ testCase: i + 1, passed, result, expectedOutput });
            } catch (err) {
              results.push({ testCase: i + 1, passed: false, error: err.message, expectedOutput });
            }
          }
          parentPort.postMessage({ results });
        } catch (err) {
          parentPort.postMessage({ error: err.message });
        }
      });
    `, { eval: true });

    // Listen for results from the worker
    worker.on('message', (message) => {
      if (message.results) {
        resolve(message.results);
      } else {
        resolve(
          testCases.map((testCase, i) => ({
            testCase: i + 1,
            passed: false,
            error: message.error || 'Unknown error',
            expectedOutput: testCase.output.output
          })),
        );
      }
      worker.terminate(); // Terminate the worker after processing
    });

    // Handle worker errors
    worker.on('error', (err) => {
      console.error('Worker error:', err);
      resolve(
        testCases.map((testCase, i) => ({
          testCase: i + 1,
          passed: false,
          error: 'Worker thread error',
          expectedOutput: testCase.output.output
        })),
      );
      worker.terminate(); // Ensure the worker is terminated
    });

    // Enforce timeout by killing the worker
    setTimeout(() => {
      worker.terminate();
      resolve(
        testCases.map((testCase, i) => ({
          testCase: i + 1,
          passed: false,
          error: 'TLE',
          expectedOutput: testCase.output.output
        })),
      );
    }, 1000); // Timeout set to 1 second

    // Send code and test cases to the worker
    worker.postMessage({ code, testCases });
  });
}

app.listen(port, () => {
  console.log(`Server running on port:${port}`);
});
