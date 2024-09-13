const express = require('express');
const bodyparser = require('body-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const xlsx = require('xlsx'); // For handling Excel
const axios = require('axios'); // For downloading PDF
const pdfParse = require('pdf-parse'); // For parsing PDF
const cors = require('cors');
require('dotenv').config();
const app = express();
app.use(express.json());
app.use(cors());
app.use(bodyparser.json());

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Function to fetch and parse PDF from Firebase
const fetchAndParsePdf = async (pdfUrl) => {
    try {
        const response = await axios({
            url: pdfUrl,
            method: 'GET',
            responseType: 'arraybuffer', // Get the file in binary format
        });
        const pdfData = await pdfParse(response.data);
        return pdfData.text; // Extracted text from the PDF
    } catch (error) {
        console.error('Error fetching or parsing PDF:', error);
        throw error;
    }
};

// Endpoint to generate questions
app.post('/generate-questions', async (req, res) => {
    const { questionType, numberOfQuestions, topic, fileUrl } = req.body;
    let fileContent = '';

    // If a Firebase file URL is provided, fetch and parse the PDF content
    if (fileUrl) {
        try {
            fileContent = await fetchAndParsePdf(fileUrl);
        } catch (error) {
            return res.status(500).json({ error: 'Error reading PDF content' });
        }
    }

    let mcqQuestions = [];
    let descriptiveQuestions = [];

    for (let i = 0; i < numberOfQuestions; i++) {
        try {
            const prompt = `Generate a ${questionType === 'mcq' ? 'multiple choice question' : 'descriptive question'} on the topic: ${topic}. ${
              fileContent ? `Use the following content: ${fileContent}` : ''
            } Please provide it as an array of objects with keys: question, opt1, opt2, opt3, opt4, and correctAnswer as Option number.`;

            const result = await model.generateContent(prompt);
            const generatedText = result.response.text();

            if (questionType === 'mcq') {
                const mcqArray = parseMCQData(generatedText);
                mcqQuestions = mcqQuestions.concat(mcqArray);
            } else {
                const desc = {
                    Question: generatedText
                };
                descriptiveQuestions.push(desc);
            }
        } catch (error) {
            return res.status(500).json({ error: 'Error generating questions' });
        }
    }

    // Generate Excel file buffer
    try {
        const fileBuffer = generateExcelBuffer(mcqQuestions, descriptiveQuestions);
        res.setHeader('Content-Disposition', 'attachment; filename=questions.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(fileBuffer);
    } catch (error) {
        res.status(500).json({ error: 'Error generating the Excel file' });
    }
});

// Helper function to clean and parse MCQ data
const parseMCQData = (text) => {
    try {
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').replace(/[\n\r]+/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (error) {
        console.log('Error parsing MCQ data:', error);
        return [];
    }
};

// Helper function to save questions to Excel and return buffer
const generateExcelBuffer = (mcqQuestions, descriptiveQuestions) => {
    const workbook = xlsx.utils.book_new();

    if (mcqQuestions.length > 0) {
        const mcqSheet = xlsx.utils.json_to_sheet(mcqQuestions);
        xlsx.utils.book_append_sheet(workbook, mcqSheet, 'MCQ Questions');
    }

    if (descriptiveQuestions.length > 0) {
        const descSheet = xlsx.utils.json_to_sheet(descriptiveQuestions);
        xlsx.utils.book_append_sheet(workbook, descSheet, 'Descriptive Questions');
    }

    return xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
};

// Start the server
app.listen(4500, () => {
    console.log('App is listening at 4500');
});