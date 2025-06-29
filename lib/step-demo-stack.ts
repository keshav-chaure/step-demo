import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as iam from "aws-cdk-lib/aws-iam";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class StepDemoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket
    const bucket = new s3.Bucket(this, "UploadCsvBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Lambda 1 - Process CSV and return progressId
    const processLambda = new lambda.Function(this, "ProcessFileLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "process-file.handler",
      code: lambda.Code.fromAsset("lambda"),
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
    });

    bucket.grantRead(processLambda);

    bucket.grantRead(processLambda);

    // Lambda 2 - Check progress and return status
    const checkProgressLambda = new lambda.Function(
      this,
      "CheckProgressLambda",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "check-progress.handler",
        code: lambda.Code.fromAsset("lambda"),
      }
    );

    // Step Function - chain both Lambdas
    const task1 = new tasks.LambdaInvoke(this, "Call Process Lambda", {
      lambdaFunction: processLambda,
      outputPath: "$.Payload",
    });

    const task2 = new tasks.LambdaInvoke(this, "Check Progress Lambda", {
      lambdaFunction: checkProgressLambda,
      outputPath: "$.Payload",
    });

    const successState = new sfn.Succeed(this, "Success");
    const failureState = new sfn.Fail(this, "Failure");

    const choice = new sfn.Choice(this, "Was it successful?");
    choice.when(
      sfn.Condition.stringEquals("$.status", "SUCCESS"),
      successState
    );
    choice.when(
      sfn.Condition.stringEquals("$.status", "FAILURE"),
      failureState
    );
    choice.otherwise(failureState);

    const waitState = new sfn.Wait(this, "Wait 3 Minutes", {
      time: sfn.WaitTime.duration(cdk.Duration.minutes(3)),
    });

    const definition = task1.next(waitState).next(task2).next(choice);

    const stateMachine = new sfn.StateMachine(this, "S3CsvStepFunction", {
      definition,
      timeout: cdk.Duration.minutes(5),
    });

    // Grant StepFunction permission to invoke Lambdas
    processLambda.grantInvoke(stateMachine.role);
    checkProgressLambda.grantInvoke(stateMachine.role);

    // S3 triggers Step Function (via Lambda)
    const triggerLambda = new lambda.Function(
      this,
      "TriggerStateMachineLambda",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromInline(`
        const AWS = require('aws-sdk');
        const stepfunctions = new AWS.StepFunctions();
        exports.handler = async (event) => {
          const params = {
            stateMachineArn: process.env.STATE_MACHINE_ARN,
            input: JSON.stringify(event)
          };
          await stepfunctions.startExecution(params).promise();
        };
      `),
        environment: {
          STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        },
      }
    );

    stateMachine.grantStartExecution(triggerLambda);

    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(triggerLambda)
    );

    bucket.grantRead(triggerLambda);
    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'StepDemoQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
