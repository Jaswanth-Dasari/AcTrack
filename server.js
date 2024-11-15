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
require('dotenv').config();


const app = express();
const PORT = 5000;

// AWS S3 Configuration
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,      // Your AWS Access Key
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,  // Your AWS Secret Access Key
    region: process.env.AWS_REGION                   // Your AWS Region
});

const bucketName = process.env.S3_BUCKET_NAME;        // S3 bucket name

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

const BrowserActivities = mongoose.model('browserActivities', browserActivitiesSchema);


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
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Add the root route ("/") to serve the "index.html"
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
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
    const userId = req.body.userId || "user123";  // Replace with actual user ID management if needed

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

// Endpoint to fetch the most recent 5 records
app.get('/api/browser-activities', async (req, res) => {
    try {
      const activities = await BrowserActivities.find()
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
  app.get('/api/browser-activities', async (req, res) => {
  try {
    const activities = await BrowserActivities.find()
      .sort({ date: -1 }) // Sort by date, descending
      .limit(5); // Limit to 5 records

    // Log data to confirm it is fetched from MongoDB
    if (activities.length > 0) {
      console.log('Fetched Activities:', activities);
    } else {
      console.log('No data found in the browseractivities collection');
    }

    // Send data to frontend
    const formattedActivities = activities.map((activity) => ({
      title: activity.title,
      application: activity.projectId,  // Rename projectId to application
      timeSpentPercentage: activity.timeSpentPercentage,
    }));

    res.json(formattedActivities);
  } catch (err) {
    console.error('Error fetching activities:', err);
    res.status(500).json({ error: err.message });
  }
});





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


app.post('/api/login', async (req, res) => {
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
        return res.status(200).json({ message: 'Login successful', redirectUrl: '/index.html' });
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
    return res.redirect('/login.html'); // Redirect to login if not authenticated
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