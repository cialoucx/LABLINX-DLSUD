const passport = require("passport");
const MicrosoftStrategy = require("passport-microsoft").Strategy;
const User = require("../models/User");

const initPassport = (passportInstance) => {
  const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
  const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
  const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID;
  const CALLBACK_URL = process.env.MICROSOFT_CALLBACK_URL;

  const isPlaceholder = (val) => !val || val.startsWith("placeholder_");

  if (
    isPlaceholder(MICROSOFT_CLIENT_ID) ||
    isPlaceholder(MICROSOFT_CLIENT_SECRET) ||
    isPlaceholder(MICROSOFT_TENANT_ID) ||
    !CALLBACK_URL
  ) {
    console.warn(
      "⚠️ Microsoft OAuth variables are missing or placeholders. Microsoft SSO is disabled.",
    );
  } else {
    passportInstance.use(
      new MicrosoftStrategy(
        {
          clientID: MICROSOFT_CLIENT_ID,
          clientSecret: MICROSOFT_CLIENT_SECRET,
          callbackURL: CALLBACK_URL,
          scope: ["user.read"],
          tenant: MICROSOFT_TENANT_ID,
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const email =
              profile.emails && profile.emails.length > 0
                ? profile.emails[0].value
                : null;
            if (!email) {
              return done(null, false, {
                message: "No email returned from Microsoft.",
              });
            }

            const user = await User.findOne({
              email: new RegExp(`^${email}$`, "i"),
            });

            if (!user) {
              return done(null, false, {
                message:
                  "This Microsoft account is not registered in our system.",
              });
            }

            if (user.status === "Pending") {
              return done(null, false, {
                message: "Your account is still pending admin approval.",
              });
            }

            return done(null, user);
          } catch (err) {
            return done(err);
          }
        },
      ),
    );
  }

  passportInstance.serializeUser((user, done) => {
    done(null, user.id);
  });

  passportInstance.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
};

module.exports = { initPassport };
