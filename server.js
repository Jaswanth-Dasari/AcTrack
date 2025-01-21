const express = require('express');
const mongoose = require('mongoose');
const screenshot = require('screenshot-desktop');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer'); 
const AWS = require('aws-sdk');
const dotenv=require('dotenv');
const multer=require('multer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid'); // Use UUID for unique userId generation
const jwt = require('jsonwebtoken');
require('dotenv').config();


const app = express();
const PORT = 5000;
const allowedOrigins = ['https://actracker.onrender.com'];

// AWS S3 Configuration
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,      // Your AWS Access Key
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,  // Your AWS Secret Access Key
    region: process.env.AWS_REGION                   // Your AWS Region
});

const bucketName = process.env.S3_BUCKET_NAME;        // S3 bucket name
const JWT_SECRET = process.env.JWT_SECRET 

// MongoDB connection
const mongoURI = process.env.MONGO_URI; 
mongoose.connect(mongoURI, {})
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error:', err));

    const projectSchema = new mongoose.Schema({
        projectName: { type: String, required: true }, 
        clientName: { type: String, required: true },  
        isBillable: { type: Boolean, default: false }, 
        members: {
            managers: { type: [String], default: [] },  
            users: { type: [String], default: [] },     
            viewers: { type: [String], default: [] }    
        },
        budget: {
            budgetType: { type: String, required: true }, 
            basedOn: { type: String, required: true },    
            cost: { type: Number, required: true }        
        },
        teams: { type: [String], required: true } 
    });

const screenshotSchema = new mongoose.Schema({
    userId: String,          // User ID for tracking who took the screenshot
    timestamp: { 
        type: Date, 
        default: Date.now     // Automatically adds the date and time of the screenshot
    },
    imagePath: String        // Path to the saved screenshot
});

const browserActivitiesSchema = new mongoose.Schema({
    userId: String,
    projectId: String,
    title: String,
    application:String,
    timeSpentPercentage: Number, // Percentage of time spent on the URL during tracking
    date: { type: Date, default: Date.now }
});

const browserActivities = mongoose.model('browserActivities', browserActivitiesSchema);


const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true }, // Full name of the user
    email: { type: String, required: true, unique: true }, // Unique email
    password: { type: String, required: true }, // Hashed password
    userId: { type: String, required: true, unique: true }, // Unique userId in the format US0001
});

userSchema.pre('save', async function (next) {
    if (this.isNew) {
        try {
            const lastUser = await mongoose.model('User').findOne().sort({ userId: -1 }).exec();
            if (lastUser && lastUser.userId) {
                const lastId = parseInt(lastUser.userId.slice(2)); // Extract the numeric part
                this.userId = `US${String(lastId + 1).padStart(4, '0')}`;
            } else {
                this.userId = 'US0001'; // Default for the first user
            }
        } catch (err) {
            console.error('Error generating userId:', err);
            next(err); // Pass the error to the next middleware
        }
    }
    next();
});

const User = mongoose.model('User', userSchema);


const Screenshot = mongoose.model('Screenshot', screenshotSchema);
const Project = mongoose.model('Project', projectSchema);

// Middleware
app.use(bodyParser.json());
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like desktop apps)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log('Blocked origin:', origin);
            callback(null, true); // Allow all origins for now since desktop app needs access
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
}));

// Add OPTIONS handler for preflight requests
app.options('*', cors());
app.use(express.static(path.join(__dirname, 'public')));
// Make sure body parsing middleware is properly configured
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('Request body:', JSON.stringify(req.body, null, 2));
    }
    next();
});


// Add the root route ("/") to serve the "index.html"
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/index', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); // Adjust 'public' to the correct folder
});

// POST endpoint to save a new project
app.post('/projects', async (req, res) => {
    console.log('Received data:', req.body);  // Log the received data

    try {
        // Create the new project using the request body
        const newProject = new Project({
            projectName: req.body.projectName,
            clientName: req.body.clientName,
            isBillable: req.body.isBillable || false,
            members: {
                managers: req.body.managers ? req.body.managers.split(',').map(item => item.trim()) : [], // Split and trim to handle extra spaces
                users: req.body.users ? req.body.users.split(',').map(item => item.trim()) : [],
                viewers: req.body.viewers ? req.body.viewers.split(',').map(item => item.trim()) : []
            },
            budget: {
                budgetType: req.body.budgetType || '',
                basedOn: req.body.basedOn || '',
                cost: parseFloat(req.body.cost) || 0 // Ensure cost is stored as a number
            },
            teams: req.body.teamsSearch ? [req.body.teamsSearch] : [] // Store teams in an array
        });

        const savedProject = await newProject.save();
        res.status(201).json(savedProject);
    } catch (error) {
        console.error('Error saving project:', error);  // Detailed error logging
        res.status(500).json({ error: error.message });
    }
});

app.use(bodyParser.json()); // Ensure this line is present




// GET endpoint to fetch all projects
app.get('/projects', async (req, res) => {
    try {
        const projects = await Project.find();
        res.status(200).json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Store project members
app.post('/projects/members', async (req, res) => {
    const { projectId, managers, users, viewers } = req.body;

    try {
        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        project.members.managers = managers || [];
        project.members.users = users || [];
        project.members.viewers = viewers || [];
        await project.save();

        res.status(200).json(project);
    } catch (error) {
        console.error('Error saving members:', error);
        res.status(400).json({ error: error.message });
    }
});
// Endpoint to get projects worked this week
app.get('/api/projects/this-week', async (req, res) => {
    try {
        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Start of the week (Sunday)

        const projectsThisWeek = await Project.find({
            createdAt: { $gte: startOfWeek } // Filter projects created this week
        });

        res.status(200).json({ count: projectsThisWeek.length });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching projects', details: error.message });
    }
});

// Endpoint to get projects worked today
app.get('/api/projects/today', async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0); // Start of the day

        const projectsToday = await Project.find({
            createdAt: { $gte: startOfDay } // Filter projects created today
        });

        res.status(200).json({ count: projectsToday.length });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching projects', details: error.message });
    }
});


// Save budget to a project
app.post('/projects/budget', async (req, res) => {
    try {
        const { budgetType, basedOn, cost, projectId } = req.body;
        const project = await Project.findById(projectId);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        project.budget.budgetType = budgetType || project.budget.budgetType;
        project.budget.basedOn = basedOn || project.budget.basedOn;
        project.budget.cost = cost || project.budget.cost;
        await project.save();

        res.status(200).json(project);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Save teams to a project
app.post('/projects/teams', async (req, res) => {
    try {
        const { teamsSearch, projectId } = req.body;
        const project = await Project.findById(projectId);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        project.teams.push(teamsSearch); // Add team to the existing array
        await project.save();

        res.status(200).json(project);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

const upload = multer({ storage: multer.memoryStorage() });

// app.post('/take-screenshot', async (req, res) => {
//     const userId = req.body.userId || "user123";  // Ideally, get this from authentication

//     try {
//         // Take a screenshot
//         const img = await screenshot({ format: 'png' });

//         // Define the S3 file parameters without the ACL field
//         const s3Params = {
//             Bucket: bucketName,
//             Key: `screenshots/screenshot-${Date.now()}.png`,  // File name in S3
//             Body: img,
//             ContentType: 'image/png'
//         };

//         // Upload the screenshot to S3
//         s3.upload(s3Params, async (err, data) => {
//             if (err) {
//                 console.error('Error uploading to S3:', err);
//                 return res.status(500).json({ error: 'Error uploading to S3', details: err });
//             }

//             // Save the screenshot info (URL) in MongoDB
//             const newScreenshot = new Screenshot({
//                 userId: userId,
//                 imageUrl: data.Location  // URL of the image in S3
//             });

//             await newScreenshot.save();

//             // Respond with the screenshot details
//             res.status(201).json({
//                 message: 'Screenshot saved successfully to S3',
//                 screenshot: newScreenshot
//             });
//         });
//     } catch (err) {
//         console.error('Error taking screenshot:', err);
//         res.status(500).json({ error: 'Error taking screenshot', details: err });
//     }
// });

// Define the /api/upload-screenshot endpoint
app.post('/api/upload-screenshot', upload.single('screenshot'), async (req, res) => {
    const userId = req.body.userId ;  // Replace with actual user ID management if needed

    try {
        // Check if a file was uploaded
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        // Define parameters for the S3 upload
        const s3Params = {
            Bucket: bucketName,
            Key: `screenshots/screenshot-${Date.now()}.png`,  // Unique file name
            Body: req.file.buffer,                            // File content from multer
            ContentType: req.file.mimetype                    // File MIME type
        };

        // Upload the file to S3
        s3.upload(s3Params, async (err, data) => {
            if (err) {
                console.error('Error uploading to S3:', err);
                return res.status(500).json({ success: false, message: 'Error uploading to S3', details: err });
            }

            // Create a new screenshot record in MongoDB with the S3 URL
            const newScreenshot = new Screenshot({
                userId: userId,
                imageUrl: data.Location  // S3 URL
            });

            await newScreenshot.save();

            // Respond with a success message and screenshot data
            res.status(201).json({
                success: true,
                message: 'Screenshot uploaded successfully to S3',
                screenshot: newScreenshot
            });
        });
    } catch (error) {
        console.error('Error saving uploaded screenshot:', error);
        res.status(500).json({ success: false, message: 'Error saving uploaded screenshot', details: error.message });
    }
});
// // Take a screenshot and save it to MongoDB
// app.post('/api/take-screenshot', async (req, res) => {
//     const userId = req.body.userId || "user123";  // Ideally, get this from authentication
//     const screenshotPath = path.join(__dirname, 'public', 'screenshots', `screenshot-${Date.now()}.png`);

//     try {
//         // Take a screenshot and save it locally
//         const img = await screenshot({ format: 'png' });
//         fs.writeFileSync(screenshotPath, img);

//         // Save screenshot details in MongoDB
//         const newScreenshot = new Screenshot({
//             userId: userId,
//             imagePath: `/screenshots/${path.basename(screenshotPath)}`  // Save relative path
//         });

//         await newScreenshot.save();

//         // Respond with the screenshot details
//         res.status(201).json({
//             message: 'Screenshot saved successfully',
//             screenshot: newScreenshot
//         });
//     } catch (err) {
//         console.error('Error taking screenshot:', err);
//         res.status(500).json({ error: 'Error taking screenshot', details: err });
//     }
// });


// Retrieve user activities
app.get('/api/get-activity/:userId', (req, res) => {
    const userId = req.params.userId;
    UserActivity.find({ userId: userId })
        .then(activities => res.json(activities))
        .catch(err => res.status(500).json({ error: 'Error retrieving user activities', details: err }));
});

// Retrieve screenshots
app.get('/api/get-screenshots/:userId', (req, res) => {
    const userId = req.params.userId;
    Screenshot.find({ userId: userId })
        .then(screenshots => {
            console.log('Retrieved Screenshots:', screenshots);  // Log the screenshots to the console
            res.json(screenshots);  // Send the screenshots in the response
        })
        .catch(err => {
            console.error('Error retrieving screenshots:', err);  // Log the error to the console
            res.status(500).json({ error: 'Error retrieving screenshots', details: err });
        });
        // Limit the number of screenshots fetched (e.g., 5)
        const maxScreenshots = 6;
        const screenshotUrls = data.Contents.map(item => {
            return {
                url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
                timestamp: item.LastModified
            };
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, maxScreenshots);  // Limit to the most recent 5

});


// API to get recent screenshots
// app.get('/api/recent-screenshots', async (req, res) => {
//     try {
//         const screenshots = await Screenshot.find().sort({ timestamp: -1 }).limit(5);  // Get the latest 5 screenshots
//         res.status(200).json(screenshots);
//     } catch (error) {
//         res.status(500).json({ error: 'Error fetching recent screenshots', details: error });
//     }
// });

// Endpoint to fetch recent screenshots from S3 bucket
app.get('/api/recent-screenshots', async (req, res) => {
    const params = {
        Bucket: bucketName,
        Prefix: 'screenshots/', // Folder where screenshots are stored
    };

    try {
        // List objects in the bucket with the specified prefix
        const data = await s3.listObjectsV2(params).promise();

        // Extract the URLs of the screenshots
        const screenshotUrls = data.Contents.map(item => {
            return {
                url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
                timestamp: item.LastModified  // Get the timestamp of the file
            };
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));  // Sort by timestamp

        // Return the list of URLs
        res.status(200).json(screenshotUrls);
    } catch (error) {
        console.error('Error fetching screenshots from S3:', error);
        res.status(500).json({ error: 'Error fetching screenshots', details: error.message });
    }
});

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER, // Gmail user
        pass: process.env.EMAIL_PASS, // Gmail password or app password
    }
});

// Check if transport configuration is correct
transporter.verify(function (error, success) {
    if (error) {
        console.log("Error with transporter configuration: ", error);
    } else {
        console.log("Transporter is ready to send emails.");
    }
});

// Async function to send an email
async function sendEmail(toEmail, inviteLink) {
    try {
        // Log the email being sent and the invite link for debugging
        console.log('Preparing to send email to:', toEmail);
        console.log('Invite link:', inviteLink);

        // Send mail with defined transport object
        let info = await transporter.sendMail({
            from: `"AcTrack" <${process.env.EMAIL_USER}>`, // sender address
            to: toEmail, // receiver address
            subject: "You are invited to join the team!", // Subject line
            html: `
                <h1>Team Invitation</h1>
                <p>You have been invited to join our team. Click the link below to accept the invitation:</p>
                <a href="${inviteLink}">Join the Team</a>
            `
        });

        console.log('Message sent successfully, ID:', info.messageId); // Log success message
        return info; // Return info if successful
    } catch (error) {
        console.error('Error sending email:', error); // Log detailed error information
        throw error; // Throw error so it can be caught by the caller
    }
}

// POST endpoint to handle sending the email invitation
app.post('/api/send-invite', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        console.log('No email provided in request body.');
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        // Log received email for debugging
        console.log('Received request to send invite to:', email);

        // Generate an invitation link (replace with your actual app URL)
        const inviteLink = `http://actracker.onrender.com`;

        // Send the email
        await sendEmail(email, inviteLink);

        // Respond with success message
        console.log('Invitation sent successfully to:', email);
        res.status(200).json({ message: 'Invitation sent successfully!' });
    } catch (error) {
        console.error('Error while processing invitation request:', error);
        res.status(500).json({ error: 'Failed to send invitation', details: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
app.get('/projects/count', async (req, res) => {
    try {
        const count = await Project.countDocuments();
        res.json({ count });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
const timeEntrySchema = new mongoose.Schema({
    userId: String,
    projectId: String,   // ID of the project
    workedTime: Number,  // Time in seconds
    date: { type: Date, default: Date.now } // Automatically adds date when the entry is created
});

const TimeEntry = mongoose.model('TimeEntry', timeEntrySchema);
// POST endpoint to save time entry for a project
app.post('/api/save-time-entry', async (req, res) => {
    const { userId, projectId, workedTime } = req.body;

    try {
        const newTimeEntry = new TimeEntry({
            userId: userId,
            projectId: projectId,
            workedTime: workedTime
        });

        const savedTimeEntry = await newTimeEntry.save();
        res.status(201).json(savedTimeEntry);
    } catch (error) {
        console.error('Error saving time entry:', error);
        res.status(500).json({ error: 'Error saving time entry', details: error.message });
    }
});
// Example: Update when starting the timer
// Example: Update when starting the timer
app.post('/start-timer', async (req, res) => {
    const { projectId } = req.body;
    try {
        // Update the last worked date when the timer starts
        const updatedProject = await Project.findByIdAndUpdate(
            projectId,
            { lastWorked: new Date() }, // Update to current date
            { new: true } // Return the updated document
        );

        if (!updatedProject) {
            return res.status(404).json({ message: 'Project not found.' });
        }

        // Start timer logic...
        res.status(200).json({ message: 'Timer started and project updated.', project: updatedProject });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Example: Update when stopping the timer
// Endpoint to stop the timer
app.post('/stop-timer', async (req, res) => {
    const { projectId } = req.body; // Assuming you send projectId when stopping the timer

    try {
        // Update the last worked date when the timer stops
        const updatedProject = await Project.findByIdAndUpdate(
            projectId,
            { lastWorked: new Date() }, // Set to current date and time
            { new: true } // Return the updated document
        );

        if (!updatedProject) {
            return res.status(404).json({ message: 'Project not found.' });
        }

        // Stop timer logic...
        res.status(200).json({ message: 'Timer stopped and project updated.', project: updatedProject });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const userActivitySchema = new mongoose.Schema({
    userId: String,          // User ID for tracking activity
    projectId: String,       // ID of the project being worked on
    date: { type: Date, default: Date.now }, // Date and time of activity
    mouseEvents: { type: Number, default: 0 }, // Mouse activity count
    keyboardEvents: { type: Number, default: 0 }, // Keyboard activity count
    totalTime: { type: Number, default: 0 }, // Total time in seconds
    mouseUsagePercentage: Number,  // Calculated percentage of mouse usage
    keyboardUsagePercentage: Number, // Calculated percentage of keyboard usage
    projectName: String
});

const UserActivity = mongoose.model('UserActivity', userActivitySchema);
app.post('/api/save-activity', async (req, res) => {
    const { userId, projectId, mouseEvents, keyboardEvents, totalTime, mouseUsagePercentage, keyboardUsagePercentage } = req.body;

    try {
        const newActivity = new UserActivity({
            userId,
            projectId,
            mouseEvents,
            keyboardEvents,
            totalTime,
            mouseUsagePercentage,
            keyboardUsagePercentage,
        });

        const savedActivity = await newActivity.save();
        res.status(201).json(savedActivity);
    } catch (error) {
        console.error('Error saving user activity:', error);
        res.status(500).json({ message: 'Error saving user activity', details: error.message });
    }
});
app.get('/api/get-activity/:projectId', async (req, res) => {
    const { projectId } = req.params;

    try {
        const activities = await UserActivity.find({ projectId }).sort({ date: 1 }); // Sort by date
        res.status(200).json(activities);
    } catch (error) {
        console.error('Error fetching activity data:', error);
        res.status(500).json({ message: 'Error fetching activity data', details: error.message });
    }
});
app.get('/api/total-worked-time-this-week/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        // Get the start and end of the current week (Sunday to Saturday)
        const now = new Date();
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())); // Get Sunday of this week
        startOfWeek.setHours(0, 0, 0, 0); // Set to midnight

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6); // Set to Saturday
        endOfWeek.setHours(23, 59, 59, 999); // Set to end of the day

        // Find all time entries for the current week
        const timeEntries = await TimeEntry.find({
            userId: userId,
            date: { $gte: startOfWeek, $lte: endOfWeek } // Filter time entries between Sunday and Saturday
        });

        // Sum up the total worked time (in seconds)
        const totalWorkedSeconds = timeEntries.reduce((acc, entry) => acc + entry.workedTime, 0);

        res.status(200).json({ totalWorkedSeconds });
    } catch (error) {
        console.error('Error fetching worked time for the week:', error);
        res.status(500).json({ message: 'Error fetching worked time for the week', details: error.message });
    }
});
app.get('/api/activity-this-week/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        // Get the start and end of the current week (Sunday to Saturday)
        const now = new Date();
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())); // Get Sunday of this week
        startOfWeek.setHours(0, 0, 0, 0); // Set to midnight

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6); // Set to Saturday
        endOfWeek.setHours(23, 59, 59, 999); // Set to end of the day

        // Fetch user activity for the current week
        const activityThisWeek = await UserActivity.find({
            userId: userId,
            date: { $gte: startOfWeek, $lte: endOfWeek }
        }).sort({ date: 1 }); // Sort by date to get activities from Sunday to Saturday

        // Send activity data to the frontend
        res.status(200).json(activityThisWeek);
    } catch (error) {
        console.error('Error fetching activity for this week:', error);
        res.status(500).json({ message: 'Error fetching activity for this week', details: error.message });
    }
});

app.get('/api/browser-activities/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        console.log('Server: Fetching activities for user:', userId);

        // Ensure we're using the correct model and query
        const activities = await browserActivities
            .find({ 
                userId: userId.toString().trim() // Clean and convert userId to string
            })
            .sort({ timestamp: -1 })
            .limit(5);

        console.log(`Server: Found ${activities.length} activities for user:`, userId);

        // Always return a 200 status, even with empty results
        res.status(200).json(activities || []);

    } catch (error) {
        console.error('Server: Error fetching browser activities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

  
//   app.get('/api/browser-activities', async (req, res) => {
//   try {
//     const activities = await BrowserActivities.find()
//       .sort({ date: -1 }) // Sort by date, descending
//       .limit(5); // Limit to 5 records

//     // Log data to confirm it is fetched from MongoDB
//     if (activities.length > 0) {
//       console.log('Fetched Activities:', activities);
//     } else {
//       console.log('No data found in the browseractivities collection');
//     }

//     // Send data to frontend
//     const formattedActivities = activities.map((activity) => ({
//       title: activity.title,
//       application: activity.projectId,  // Rename projectId to application
//       timeSpentPercentage: activity.timeSpentPercentage,
//     }));

//     res.json(formattedActivities);
//   } catch (err) {
//     console.error('Error fetching activities:', err);
//     res.status(500).json({ error: err.message });
//   }
// });





app.delete('/api/delete-screenshot', async (req, res) => {
    const { url } = req.body;

    // Log the URL received for verification
    console.log('URL received for deletion:', url);

    // Extract the key from the S3 URL by removing the bucket domain part
    const key = url.replace(`https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/`, '');

    // Log the extracted key for verification
    console.log('Extracted S3 Key:', key);

    // Define the delete parameters for S3, ensuring Key is valid
    const params = {
        Bucket: bucketName,
        Key: key
    };

    try {
        // Attempt to delete the object from S3
        await s3.deleteObject(params).promise();
        // Also delete the corresponding MongoDB entry
        await Screenshot.deleteOne({ imageUrl: url });
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting screenshot:', error);
        res.status(500).json({ success: false, message: 'Failed to delete screenshot' });
    }
});
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 60000 }
}));
app.get('/api/check-session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});


app.post('/api/dashboard', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found');
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log('Password does not match');
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // If valid credentials, set session
        req.session.user = { id: user._id, email: user.email };
        console.log('Login successful');
        return res.status(200).json({ message: 'Login successful', redirectUrl: '/dashboard.html' });
    } catch (err) {
        console.error('Error during login:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});



// Middleware to protect routes
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    return res.redirect('/dashboard.html'); // Redirect to login if not authenticated
};

app.use(express.static('public')); // Assuming your HTML files are in the 'public' directory

// Protected Route (e.g., for index.html)
app.get('/index.html', isAuthenticated, (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});


app.post('/api/register', async (req, res) => {
    const { fullName, email, password } = req.body;

    try {
        if (!fullName || !email || !password) {
            return res.status(400).json({ message: 'Full name, email, and password are required' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already in use' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            fullName,
            email,
            password: hashedPassword,
        });

        // Fallback: Generate `userId` if it's not set
        if (!newUser.userId) {
            const lastUser = await User.findOne().sort({ userId: -1 }).exec();
            if (lastUser && lastUser.userId) {
                const lastId = parseInt(lastUser.userId.slice(2));
                newUser.userId = `US${String(lastId + 1).padStart(4, '0')}`;
            } else {
                newUser.userId = 'US0001';
            }
        }

        await newUser.save();

        console.log('New user registered:', newUser);
        res.status(201).json({ message: 'User registered successfully', userId: newUser.userId });
    } catch (err) {
        console.error('Error during registration:', err.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.get('/api/last-screenshot/:userId', async (req, res) => {
    try {
        const params = {
            Bucket: bucketName,
            Prefix: 'screenshots/', // Specify the prefix for screenshots
        };

        // Fetch list of objects in the bucket under the "screenshots/" prefix
        const data = await s3.listObjectsV2(params).promise();

        if (!data.Contents || data.Contents.length === 0) {
            return res.status(404).json({ message: 'No screenshots found.' });
        }

        // Find the latest screenshot by sorting by LastModified
        const latestScreenshot = data.Contents
            .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))[0]; // Get the most recent item

        res.status(200).json({
            lastScreenshotTime: latestScreenshot.LastModified // Send timestamp of the latest screenshot
        });
    } catch (error) {
        console.error('Error fetching last screenshot:', error);
        res.status(500).json({ message: 'Error fetching last screenshot', details: error.message });
    }
});

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    // Ensure double digits for hours, minutes, and seconds (e.g., "01:09:08")
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

app.get('/api/last-worked-time/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Fetch the latest TimeEntry for the user, sorted by date (descending)
        const latestTimeEntry = await TimeEntry.findOne({ userId })
            .sort({ date: -1 }) // Sort by date descending (latest first)
            .exec();

        if (!latestTimeEntry) {
            return res.status(404).json({ message: 'No time entries found for this user.' });
        }

        // Convert workedTime (seconds) to HH:mm:ss format
        const formattedWorkedTime = formatTime(latestTimeEntry.workedTime);

        res.status(200).json({
            workedTime: formattedWorkedTime,
            date: new Date(latestTimeEntry.date).toLocaleString() // Return the formatted date
        });
    } catch (error) {
        console.error('Error fetching last worked time:', error);
        res.status(500).json({ message: 'Error fetching last worked time', details: error.message });
    }
});

// Endpoint to fetch the most recent 5 records
app.get('/api/browser-activities', async (req, res) => {
    try {
      const activities = await browserActivities.find()
        .sort({ date: -1 }) // Sort by date in descending order
        .limit(5); // Limit to 5 records
  
      // Log data to confirm it's being retrieved
      console.log('Fetched Activities:', activities);
  
      // Send data to frontend
      const formattedActivities = activities.map((activity) => ({
        title: activity.title,
        application: activity.application,
        timeSpentPercentage: activity.timeSpentPercentage,
      }));
  
      res.json(formattedActivities);
    } catch (err) {
      console.error('Error fetching activities:', err);
      res.status(500).json({ error: err.message });
    }
  });

app.post('/api/browser-activities', async (req, res) => {
    const activities = req.body.activities;
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    // Validate that activities is an array
    if (!Array.isArray(activities)) {
        console.error('Error: activities is not an array');
        return res.status(400).json({ error: 'Invalid data format: activities should be an array' });
    }

    try {
        for (let activity of activities) {
            const { userId, projectId, title, application, timeSpentPercentage } = activity;

            if (!userId || !projectId || !title || !application || timeSpentPercentage == null) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Create a new activity document
            const activityDoc = new browserActivities({
                userId,
                projectId,
                title,
                application,
                timeSpentPercentage,
            });

            // Save the activity document in the database
            await activityDoc.save();
        }

        res.status(201).json({ message: 'Activities saved successfully' });
    } catch (error) {
        console.error('Error saving activity:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get screenshots for specific user
app.get('/api/screenshots/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const screenshots = await Screenshot.find({ userId })
            .sort({ timestamp: -1 })
            .limit(10);
        res.json(screenshots);
    } catch (error) {
        console.error('Error fetching screenshots:', error);
        res.status(500).json({ error: error.message });
    }
});

// Login endpoint
// app.post('/api/login', async (req, res) => {
//     try {
//         const { email, password } = req.body;

//         // Validate required fields
//         if (!email || !password) {
//             return res.status(400).json({ 
//                 error: 'Email and password are required' 
//             });
//         }

//         // Find user by email
//         const user = await User.findOne({ email });
//         if (!user) {
//             return res.status(401).json({ error: 'Invalid credentials' });
//         }

//         // Check password
//         const isMatch = await user.comparePassword(password);
//         if (!isMatch) {
//             return res.status(401).json({ error: 'Invalid credentials' });
//         }

//         // Generate JWT token
//         const token = jwt.sign(
//             { 
//                 userId: user.userId, 
//                 email: user.email,
//                 fullName: user.fullName 
//             },
//             process.env.JWT_SECRET,
//             { expiresIn: '24h' }
//         );

//         // Log only non-sensitive information
//         console.log('User logged in:', { userId: user.userId });

//         return res.status(200).json({
//             message: 'Login successful',
//             token,
//             userId: user.userId,
//             fullName: user.fullName
//         });
//     } catch (error) {
//         console.error('Login error occurred');
//         return res.status(500).json({ 
//             error: 'Login failed' 
//         });
//     }
// });

app.get('/api/get-screenshots/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        // Configure S3 params to list objects in user's specific folder
        const params = {
            Bucket: bucketName,
            Prefix: `screenshots/${userId}/` // Look only in user's folder
        };

        console.log(`Fetching screenshots for user: ${userId}`);
        console.log(`Looking in path: screenshots/${userId}/`);

        const data = await s3.listObjectsV2(params).promise();
        
        if (!data.Contents || data.Contents.length === 0) {
            console.log(`No screenshots found for user: ${userId}`);
            return res.status(200).json([]); // Return empty array instead of 404
        }

        // Limit to most recent screenshots and format the response
        const maxScreenshots = 6;
        const screenshotUrls = data.Contents
            .map(item => ({
                url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
                timestamp: item.LastModified,
                key: item.Key
            }))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, maxScreenshots);

        console.log(`Found ${screenshotUrls.length} screenshots for user: ${userId}`);
        res.json(screenshotUrls);

    } catch (error) {
        console.error('Error retrieving screenshots from S3:', error);
        res.status(500).json({ 
            error: 'Error retrieving screenshots', 
            details: error.message,
            userId: userId 
        });
    }
});

app.get('/api/recent-screenshots/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID is required' 
            });
        }

        console.log('Fetching screenshots for user:', userId);

        const params = {
            Bucket: bucketName,
            Prefix: `screenshots/${userId}/`,
            MaxKeys: 20
        };

        try {
            const data = await s3.listObjectsV2(params).promise();
            
            if (!data || !data.Contents || data.Contents.length === 0) {
                console.log(`No screenshots found for user ${userId}`);
                return res.status(200).json({ 
                    success: true,
                    screenshots: [] 
                });
            }

            const screenshots = data.Contents
                .filter(item => {
                    const keyParts = item.Key.split('/');
                    return keyParts[1] === userId.toString();
                })
                .map(item => ({
                    url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
                    timestamp: item.LastModified,
                    userId: userId,
                    key: item.Key
                }))
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            console.log(`Found ${screenshots.length} screenshots for user ${userId}`);
            return res.status(200).json({ 
                success: true,
                screenshots: screenshots 
            });

        } catch (s3Error) {
            console.error('S3 Error:', s3Error);
            return res.status(200).json({ 
                success: true,
                screenshots: [],
                message: 'Error accessing S3 bucket'
            });
        }

    } catch (error) {
        console.error('Server Error:', error);
        return res.status(200).json({ 
            success: true,
            screenshots: [],
            message: 'Internal server error'
        });
    }
});

// Update the login endpoint
app.post('/api/login', async (req, res) => {
    try {
        console.log('Login attempt received for email:', req.body.email);
        
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Make sure JWT_SECRET is available
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET is not configured');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        // Generate token with all necessary user info
        const token = jwt.sign(
            { 
                userId: user.userId, 
                email: user.email,
                fullName: user.fullName 
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('Login successful for user:', user.userId);

        res.status(200).json({
            message: 'Login successful',
            token,
            userId: user.userId,
            fullName: user.fullName
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed', details: error.message });
    }
});

// Update the authenticateToken middleware
function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            console.log('No authorization header');
            return res.status(401).json({ error: 'No authorization header' });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            console.log('No token provided');
            return res.status(401).json({ error: 'No token provided' });
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                console.error('Token verification failed:', err.message);
                return res.status(403).json({ error: 'Invalid token' });
            }

            req.user = decoded;
            console.log('Token verified for user:', decoded.userId);
            next();
        });
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

// Update the tasks endpoint
app.get('/api/tasks/:userId', authenticateToken, async (req, res) => {
    try {
        console.log('Fetching tasks for user:', req.params.userId);
        
        // Verify the token's userId matches the requested userId
        if (req.user.userId !== req.params.userId) {
            console.log('User ID mismatch:', req.user.userId, 'vs', req.params.userId);
            return res.status(403).json({ error: 'Unauthorized access' });
        }

        const tasks = await Task.find({ userId: req.params.userId });
        console.log(`Found ${tasks.length} tasks for user ${req.params.userId}`);
        res.json(tasks);
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/tasks/:taskId', authenticateToken, async (req, res) => {
    try {
        const task = await Task.findOneAndUpdate(
            { taskId: req.params.taskId },
            req.body,
            { new: true }
        );
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        res.json(task);
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/create', authenticateToken, async (req, res) => {
    try {
        const task = new Task(req.body);
        await task.save();
        res.status(201).json(task);
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update the daily time endpoint
app.get('/api/daily-time/all/:userId', authenticateToken, async (req, res) => {
    try {
        console.log('Fetching daily time for user:', req.params.userId);
        
        // Verify the token's userId matches the requested userId
        if (req.user.userId !== req.params.userId) {
            console.log('User ID mismatch:', req.user.userId, 'vs', req.params.userId);
            return res.status(403).json({ error: 'Unauthorized access' });
        }

        const dailyTimes = await DailyTime.find({ userId: req.params.userId });
        console.log(`Found ${dailyTimes.length} daily time entries for user ${req.params.userId}`);
        res.json(dailyTimes);
    } catch (error) {
        console.error('Error fetching daily time:', error);
        res.status(500).json({ error: error.message });
    }
});

// ... existing code ...

// Daily Time Routes
app.get('/api/daily-time/:userId', authenticateToken, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let dailyTime = await DailyTime.findOne({
            userId: req.params.userId,
            date: {
                $gte: today,
                $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
            }
        });
        
        if (!dailyTime) {
            dailyTime = new DailyTime({
                userId: req.params.userId,
                date: today,
                totalSeconds: 0,
                tasks: []
            });
            await dailyTime.save();
        }
        
        res.json(dailyTime);
    } catch (error) {
        console.error('Error fetching daily time:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/daily-time/all/:userId', authenticateToken, async (req, res) => {
    try {
        const dailyTimes = await DailyTime.find({ userId: req.params.userId });
        res.json(dailyTimes);
    } catch (error) {
        console.error('Error fetching all daily times:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/daily-time/update', authenticateToken, async (req, res) => {
    try {
        const { userId, date, taskId, seconds, title, projectName } = req.body;
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        
        let dailyTime = await DailyTime.findOne({
            userId,
            date: {
                $gte: dayStart,
                $lt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
            }
        });
        
        if (!dailyTime) {
            dailyTime = new DailyTime({
                userId,
                date: dayStart,
                totalSeconds: 0,
                tasks: []
            });
        }
        
        const existingTaskIndex = dailyTime.tasks.findIndex(t => t.taskId === taskId);
        if (existingTaskIndex !== -1) {
            dailyTime.tasks[existingTaskIndex].seconds += seconds;
        } else {
            dailyTime.tasks.push({ taskId, seconds, title, projectName });
        }
        
        dailyTime.totalSeconds = dailyTime.tasks.reduce((total, task) => total + task.seconds, 0);
        await dailyTime.save();
        
        res.json(dailyTime);
    } catch (error) {
        console.error('Error updating daily time:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add this function to check if the token is valid
function isTokenValid() {
    const token = window.auth.getToken();
    if (!token) return false;
    
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expirationTime = payload.exp * 1000; // Convert to milliseconds
        return Date.now() < expirationTime;
    } catch (error) {
        console.error('Token validation error:', error);
        return false;
    }
}

// Update the loadTasks function
async function loadTasks() {
    try {
        if (!isTokenValid()) {
            console.log('Token is invalid or expired');
            window.location.href = 'login.html';
            return;
        }

        const userId = window.auth.getUserId();
        console.log('Fetching tasks for user:', userId);
        
        const response = await fetch(`https://actracker.onrender.com/api/tasks/${userId}`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to load tasks');
        }
        
        allTasks = await response.json();
        filteredTasks = [...allTasks];
        renderTasks(filteredTasks);
        
        document.querySelector('.stat-card:nth-child(4) p').textContent = allTasks.length;
        
    } catch (error) {
        console.error('Error loading tasks:', error);
        displayNotification('Failed to load tasks', 'error');
    }
}

// Update the loadUserStats function
async function loadUserStats() {
    try {
        if (!isTokenValid()) {
            console.log('Token is invalid or expired');
            window.location.href = 'login.html';
            return;
        }

        const userId = window.auth.getUserId();
        console.log('Fetching user stats for user:', userId);
        
        const response = await fetch(`https://actracker.onrender.com/api/daily-time/all/${userId}`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to load user stats');
        }

        const dailyTimes = await response.json();
        // Rest of the function remains the same...
    } catch (error) {
        console.error('Error loading user stats:', error);
        displayNotification('Failed to load user statistics', 'error');
    }
}
// Add this before your routes
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({ 
        error: 'Internal server error', 
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Daily Time Schema
const dailyTimeSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    totalSeconds: {
        type: Number,
        default: 0
    },
    tasks: [{
        taskId: String,
        seconds: Number,
        title: String,
        projectName: String
    }]
}, { timestamps: true });

// Task Schema
const taskSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    taskId: {
        type: String,
        required: true,
        unique: true
    },
    title: {
        type: String,
        required: true
    },
    description: String,
    projectName: String,
    status: {
        type: String,
        enum: ['pending', 'completed'],
        default: 'pending'
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High', 'Overdue'],
        default: 'Medium'
    },
    dueDate: Date
}, { timestamps: true });

const Task = mongoose.model('Task', taskSchema);
const DailyTime = mongoose.model('DailyTime', dailyTimeSchema);
