exports.handler = async (event) => {
  const s3 = event.Records[0].s3;
  const bucket = s3.bucket.name;
  const key = decodeURIComponent(s3.object.key);

  console.log(`Processing file: ${key} from ${bucket}`);

  // simulate calling API and returning progressId
  const progressId = `progress-${Date.now()}`;
  return { progressId };
};
