var jwt = require('jwt-simple'),
	tokenSecret = "artdeko",
	utilities = require('../libs/utilities'),
	pg = require('pg'),
	AWS = require('aws-sdk'), 
	postgres = process.env.DATABASE_URL;

exports.setup = function(req, res) {
	var client = new pg.Client(postgres);

	client.connect();

	var dropTables = function(fn) {
		client.query("DROP TABLE IF EXISTS casts;DROP TABLE IF EXISTS tags;DROP TABLE IF EXISTS casts_tags")
		.on('end', function(r) {
			return fn && fn(null, r);
		});
	};

	var createTables = function(fn) {
		client.query("CREATE TABLE casts_tags (castid INTEGER, tagid INTEGER, PRIMARY KEY (castid,tagid));CREATE TABLE tags (tagid SERIAL, name VARCHAR(100), PRIMARY KEY (tagid));CREATE TABLE casts (castid SERIAL, created TIMESTAMP, published BOOLEAN, name VARCHAR(50), description TEXT, ownerid INTEGER, intro TEXT, outro TEXT, length FLOAT, size FLOAT, PRIMARY KEY (castid))")
		.on('end', function(r) {
			return fn && fn(null, r);
		});
	};

	var createFunctions = function(fn) {
		// AddCast Function Expects: OwnerId, DateTime, Description, Name, Inrro, Outro, Tags (comma separated)
		var addCast = "CREATE OR REPLACE FUNCTION AddCast(int, timestamp, varchar, varchar, varchar, varchar, text) RETURNS INTEGER AS $$ \
BEGIN \
INSERT INTO casts (castid, ownerid, created, published, description, name, intro, outro) \
VALUES (DEFAULT, $1, $2, false, $3, $4, $5, $6); \
INSERT INTO tags (name) \
SELECT tag \
FROM unnest(string_to_array($7, ',')) AS dt(tag) \
WHERE NOT EXISTS ( \
SELECT tagid \
FROM tags \
WHERE name = tag); \
INSERT INTO casts_tags(castid, tagid) \
SELECT currval('casts_castid_seq'::regclass), A.tagid FROM tags A WHERE A.name = ANY (string_to_array($7, ',')); \
RETURN currval('casts_castid_seq'::regclass); \
END; \
$$ language plpgsql;";

		client.query(addCast)
		.on('end', function(r) {
			return fn && fn(null, r);
		});
	};

	dropTables(function (err, result) {
		createTables(function (err, result) {
			createFunctions(function (err, result) {
				client.end();
				res.send("Casts DB setup complete");
			});
		});
	});
};

exports.publish = function(req, res) {
	if (req.headers.token === undefined) {
		res.json({ status: 401, message: "Inavlid token, authentication failed" }, 401); 
		return;
	}

	var decoded = jwt.decode(req.headers.token, tokenSecret);

	utilities.validateTokenUser(decoded.email, function(err, result) {

		if (!result.valid) {
			res.send({ status: 401, message: "Authentication failed" }, 401); 
			return;
		}

		var client = new pg.Client(postgres);

		client.connect();

		AWS.config.update({accessKeyId: 'AKIAIZYVY67XOF34ZJWQ', secretAccessKey: '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', region: 'us-east-1'});

		var sts = new AWS.STS();

		var params = { 'Name' : 'Mac', 'Policy' : '{"Statement": [{"Effect": "Allow","Action": "s3:*","Resource": "*"}]}', 'DurationSeconds' : 60 * 60 * 1 };

		sts.client.getFederationToken(params, function(err, data) {
			var response = {};

			response["federationToken"] = data;
			response["bucket-1"] = "quickcast-raw";
			response["bucket-2"] = "quickcast";
			response["user"] = result.user;

			client.query("SELECT AddCast($1,$2,$3,$4,$5,$6,$7);", [result.user.id, new Date(), req.headers.description, req.headers.name, req.headers.intro, req.headers.outro, req.headers.tags])
			.on('row', function(r) {
				response["cast"] = r;
			})
			.on('end', function(r) {
				client.end();
				res.json(response);
			});			
		});
	});
};

exports.publishComplete = function(req, res) {
	if (req.headers.token === undefined) {
		res.json({ status: 401, message: "Inavlid token, authentication failed" }, 401); 
		return;
	}

	var decoded = jwt.decode(req.headers.token, tokenSecret);

	utilities.validateTokenUser(decoded.email, function(err, result) {

		if (!result.valid) {
			res.json({ status: 401, message: "Authentication failed" }, 401); 
			return;
		}

		if (req.headers.castid === undefined) {
			res.json({ status: 400, message: "Invalid or no id supplied" }, 400); 
			return;
		}

		var client = new pg.Client(postgres);

		client.connect();

		client.query("UPDATE casts SET published = true, size = $1, length = $2 WHERE castid = $3", [req.headers.size, req.headers.length, req.headers.castid])
		.on('end', function(r) {
			client.end();
			res.json({ status: 200, message: "Successfully updated & published cast" }, 200);
		});			
	});
};

exports.index = function(req, res) {
	res.render('api/casts/index', {
		title: 'API'
	});
};